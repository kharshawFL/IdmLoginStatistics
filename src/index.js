import https from 'https';
import fs from 'fs';
import dotenv from 'dotenv';
import winston from 'winston';
import {consolidateDailyFilesAsync} from './process-daily-files.js';
import path from 'path';

dotenv.config();

const httpsAgent = new https.Agent({keepAlive: true});
const REQUEST_TIMEOUT_MS = 15000;
const MAX_ERROR_BODY_LENGTH = 1000;
const MAX_PAGE_RETRIES = 3;

const logger = winston.createLogger({
  level: 'debug',
  format: winston.format.json(),
  defaultMeta: {service: 'login-log-stats'},
  transports: [
    new winston.transports.File({filename: 'error.log', level: 'error'}),
    new winston.transports.File({filename: 'combined.log'}),
  ],
});

if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.simple(),
  }));
}

const truncateForLog = (value) => {
  if (typeof value !== 'string') {
    return value;
  }

  if (value.length <= MAX_ERROR_BODY_LENGTH) {
    return value;
  }

  return `${value.slice(0, MAX_ERROR_BODY_LENGTH)}...`;
};

const createHttpError = ({message, status, body, ...meta}) => {
  const error = new Error(message || 'Request failed');
  error.status = status;

  if (body !== undefined) {
    error.body = truncateForLog(body);
  }

  Object.assign(error, meta);
  return error;
};

const serializeError = (error) => {
  if (!error) {
    return {message: 'Unknown error'};
  }

  if (error instanceof Error) {
    const serialized = {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };

    if (error.status !== undefined) {
      serialized.status = error.status;
    }

    if (error.body !== undefined) {
      serialized.body = error.body;
    }

    Object.keys(error).forEach((key) => {
      if (!(key in serialized)) {
        serialized[key] = error[key];
      }
    });

    return serialized;
  }

  return {error};
};

const isExpiredRsidError = (error) => {
  if (!error || error.status !== 404 || typeof error.body !== 'string') {
    return false;
  }

  return error.body.includes('RSID') && error.body.includes('not found');
};

const isRetryableGetEventsError = (error) => {
  if (!error) {
    return false;
  }

  if (error.code === 'ETIMEDOUT' || error.code === 'ECONNRESET') {
    return true;
  }

  if (error.status === 408 || error.status === 429) {
    return true;
  }

  return error.status >= 500;
};

const summarizePageData = (pageData) => {
  if (pageData === null || pageData === undefined) {
    return pageData;
  }

  if (typeof pageData === 'string') {
    return truncateForLog(pageData);
  }

  try {
    return truncateForLog(JSON.stringify(pageData));
  } catch (error) {
    return '[unserializable page data]';
  }
};

const getElapsedMs = (startedAt) => Date.now() - startedAt;

const createSingleSettler = (resolve, reject) => {
  let settled = false;

  return {
    resolve(value) {
      if (settled) {
        return;
      }

      settled = true;
      resolve(value);
    },
    reject(error) {
      if (settled) {
        return;
      }

      settled = true;
      reject(error);
    },
  };
};

async function runQueryAsync(term, begin, end, token) {
  let rsid = '';
  const query = encodeURI(`q="${term}"&from=${begin}&until=${end}`);
  const requestStartedAt = Date.now();


  const options = {
    hostname: `myfrontline.loggly.com`,
    path: `/apiv2/search?${query}&size=5000`,
    method: 'GET',
    headers: {Authorization: `Bearer ${token}`},
    agent: httpsAgent,

  };

  logger.debug('searching', {
    url: `https://${options.hostname}${options.path}`,
    timeoutMs: REQUEST_TIMEOUT_MS,
  });

  const request = new Promise((resolve, reject) => {
    const settle = createSingleSettler(resolve, reject);
    const req = https.request(options, (res) => {
      let data = '';
      logger.debug('status', {
        statusCode: res.statusCode,
        elapsedMs: getElapsedMs(requestStartedAt),
      });

      res.on('data', (d) => {
        data += d.toString();
      });

      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            rsid = JSON.parse(data).rsid.id;
            logger.info('search completed', {
              rsid,
              term,
              elapsedMs: getElapsedMs(requestStartedAt),
            });
            settle.resolve(rsid);
          } catch (e) {
            e.body = truncateForLog(data);
            settle.reject(e);
          }
        } else {
          settle.reject(createHttpError({
            status: res.statusCode,
            message: res.statusMessage || 'error',
            body: data,
          }));
        }
      });

      res.on('aborted', () => {
        settle.reject(createHttpError({
          status: 502,
          message: 'Search response aborted',
          body: data,
          elapsedMs: getElapsedMs(requestStartedAt),
        }));
      });

      res.on('error', (error) => {
        settle.reject(createHttpError({
          status: 502,
          message: error.message || 'Search response stream error',
          code: error.code,
          body: data,
          elapsedMs: getElapsedMs(requestStartedAt),
        }));
      });
    });

    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy(new Error('Request timed out'));
    });

    req.end();

    req.on('error', (e) => {
      settle.reject(e);
    });
  });

  rsid = await request;
  return rsid;
}

async function getEventsAsync(rsid, page, token) {
  let events = '';
  const requestStartedAt = Date.now();

  logger.debug('fetching events page', {
    page,
    rsid,
    timeoutMs: REQUEST_TIMEOUT_MS,
  });

  const request = new Promise((resolve, reject) => {
    const settle = createSingleSettler(resolve, reject);
    const req = https.request({
      hostname: 'myfrontline.loggly.com',
      port: 443,
      path: `/apiv2/events?rsid=${rsid}&page=${page}`,
      method: 'GET',
      headers: {Authorization: `Bearer ${token}`},
      agent: httpsAgent,
    }, (res) => {
      let data ='';


      res.on('data', (d) => {
        data += d.toString();
      });

      res.on('end', () => {
        if (res.statusCode !== 200) {
          settle.reject(createHttpError({
            status: res.statusCode,
            message: res.statusMessage || 'error',
            body: data,
            rsid,
            page,
          }));
        } else {
          try {
            events = JSON.parse(data);
            logger.info('events page fetched', {
              page,
              rsid,
              elapsedMs: getElapsedMs(requestStartedAt),
              eventCount: Array.isArray(events.events) ?
                events.events.length :
                undefined,
            });
            settle.resolve(events);
          } catch (error) {
            settle.reject(createHttpError({
              message: 'Invalid JSON in events response',
              body: data,
              rsid,
              page,
              elapsedMs: getElapsedMs(requestStartedAt),
              cause: error.message,
            }));
          }
        }
      });

      res.on('aborted', () => {
        settle.reject(createHttpError({
          status: 502,
          message: 'Events response aborted',
          body: data,
          rsid,
          page,
          elapsedMs: getElapsedMs(requestStartedAt),
        }));
      });

      res.on('error', (error) => {
        settle.reject(createHttpError({
          status: 502,
          message: error.message || 'Events response stream error',
          code: error.code,
          body: data,
          rsid,
          page,
          elapsedMs: getElapsedMs(requestStartedAt),
        }));
      });
    });

    req.on('error', (e) => {
      settle.reject(createHttpError({
        status: e.message === 'Request timed out' ? 408 : 400,
        message: e.message,
        code: e.code || (
          e.message === 'Request timed out' ? 'ETIMEDOUT' : undefined
        ),
        rsid,
        page,
        elapsedMs: getElapsedMs(requestStartedAt),
      }));
    });

    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy(new Error('Request timed out'));
    });

    req.end();
  });

  try {
    events = await request;
  } catch (error) {
    logger.error('getEventsAsync error', serializeError(error));
    throw error;
  }

  return events;
}

const ensureUserLogins = (logins, username) => {
  if (!(username in logins)) {
    logins[username] = [];
  }
};

const extractUsername = (eventJson) => {
  switch (eventJson.Name) {
  case 'Local Login Success':
    return eventJson.details.LoginUserName;
  case 'External Login Success':
    // eslint-disable-next-line max-len
    return `${eventJson.details.Provider}|${eventJson.details.ProviderId}`;
  default:
    return '';
  }
};

const appendLoginEvent = (logins, eventJson) => {
  const username = extractUsername(eventJson);
  if (!username) {
    return;
  }

  ensureUserLogins(logins, username);
  // eslint-disable-next-line max-len
  logins[username].push({timestamp: eventJson.timestamp, clientID: eventJson.details.SignInMessage.ClientId});
};

const getDailyEventsAsync = async (dateToProcess, token) => {
  const dateToProcessEnd = new Date(dateToProcess);
  dateToProcessEnd.setHours(23, 59, 59, 999);

  let rsid;
  try {
    rsid = await runQueryAsync('Login Success',
      dateToProcess.toISOString(),
      dateToProcessEnd.toISOString(), token);
  } catch (e) {
    logger.error('runQueryAsync failed', serializeError(e));
    throw e;
  }
  let page = 0;

  // eslint-disable-next-line max-len
  logger.info('rsid received', {
    rsid,
    start: dateToProcess.toISOString(),
    end: dateToProcessEnd.toISOString(),
  });

  let pageData;

  const logins = {};

  let retryPage = false;
  let pageRetryCount = 0;
  do {
    retryPage = false;
    try {
      pageData = await getEventsAsync(rsid, page, token);
      pageRetryCount = 0;
    } catch (e) {
      if (isExpiredRsidError(e)) {
        logger.warn('rsid expired while fetching events; requerying', {
          page,
          expiredRsid: rsid,
        });

        try {
          rsid = await runQueryAsync('Login Success',
            dateToProcess.toISOString(),
            dateToProcessEnd.toISOString(), token);
          retryPage = true;
          pageRetryCount = 0;
          continue;
        } catch (retryError) {
          logger.error(
            'runQueryAsync retry failed',
            serializeError(retryError),
          );
          throw retryError;
        }
      }

      if (
        isRetryableGetEventsError(e) &&
        pageRetryCount < MAX_PAGE_RETRIES
      ) {
        pageRetryCount++;
        retryPage = true;
        logger.warn('retrying getEventsAsync after transient failure', {
          page,
          rsid,
          retryAttempt: pageRetryCount,
          maxRetries: MAX_PAGE_RETRIES,
          error: serializeError(e),
        });
        continue;
      }

      logger.error('getEventsAsync failed', serializeError(e));
      throw e;
    }

    logger.info('processing page', {page});

    if (pageData && Array.isArray(pageData.events)) {
      pageData.events.forEach((e) => {
        if (e.event.json.Name) {
          appendLoginEvent(logins, e.event.json);
        }
      });

      if (pageData.events.length === 0) {
        logger.info('no more events for rsid', {page, rsid});
      }

      page++;
    } else {
      logger.error('unexpected events payload', {
        page,
        rsid,
        pageData: summarizePageData(pageData),
      });
      throw createHttpError({
        message: 'Unexpected events payload',
        rsid,
        page,
        body: summarizePageData(pageData),
      });
    }
  } while (retryPage || (pageData.events && pageData.events.length > 0));

  return logins;
};

const getAuthTokenFromEnvironment = () => {
  // const username = process.env.LOGGLY_USERNAME || '';
  // const password = process.env.LOGGLY_PASSWORD || '';


  // if (!username.length || !password.length) {
  // eslint-disable-next-line max-len
  //     const message = 'The environment must specify LOGGLY_USERNAME and LOGGLY_PASSWORD';
  //     logger.warn(message);
  //     throw (message);
  // }

  // return `Basic ${Buffer.from(username
  //    + ':' + password).toString('base64')}`;

  return process.env.LOGGLY_TOKEN;
};

const displayUsage = (messages) => {
  // eslint-disable-next-line max-len
  console.log(`Usage ${process.argv[0]} ${process.argv[1]} options\r\n\t--start {startDate}\r\n\t--end {endDate}`);

  messages.forEach((m) => {
    console.log(`\tMessage: ${m}`);
  });
};

const processCommandLine = () => {
  const errors = [];

  const startArg = process.argv.indexOf('--start');
  let startDate = {};

  if (startArg >= 0) {
    const startString = process.argv[startArg+1];
    if (Date.parse(startString)) {
      startDate = new Date(startString);
    } else {
      errors.push(`Start date must be a valid date`);
    }
  } else {
    errors.push('Start date is a required command line argument');
  }

  const endArg = process.argv.indexOf('--end');
  let endDate = {};

  if (endArg >= 0) {
    const endString = process.argv[endArg+1];

    if (Date.parse(endString)) {
      endDate = new Date(endString);
    } else {
      errors.push(`end date must be a valid date`);
    }
  } else {
    errors.push('End date is a required command line argument');
  }

  return {startDate, endDate, errors};
};

const main = async () => {
  const {startDate, endDate, errors} = processCommandLine();

  if (errors.length > 0) {
    errors.forEach((e) => logger.error('argument error', {error: e}));

    displayUsage(errors);
    process.exitCode = 1;
    return;
  }

  endDate.setHours(23, 59, 59, 999);
  startDate.setHours(0, 0, 0, 0);

  const token = getAuthTokenFromEnvironment();

  // eslint-disable-next-line max-len
  logger.info('run range', {
    start: startDate.toString(),
    end: endDate.toString(),
  });

  const currentDate = new Date(startDate);

  while (currentDate < endDate) {
    let logins = {};

    // eslint-disable-next-line max-len
    const dayFile = path.join('data', `logins.${currentDate.getFullYear()}_${currentDate.getMonth()+1}_${currentDate.getDate()}.json`);

    let dayFileExists = true;
    try {
      await fs.promises.access(dayFile, fs.constants.F_OK);
    } catch (e) {
      dayFileExists = false;
    }

    if (!dayFileExists) {
      logins = await getDailyEventsAsync(currentDate, token);

      // eslint-disable-next-line max-len
      logger.info('processing day', {day: currentDate.toString()});

      await fs.promises.writeFile(dayFile, JSON.stringify(logins));
    } else {
      logger.info('outfile exists', {day: currentDate.toISOString()});
    }

    currentDate.setDate(currentDate.getDate() + 1);
  };

  // eslint-disable-next-line max-len
  const {totalLogins, uniqueLogins} = await consolidateDailyFilesAsync(startDate.toDateString(), endDate.toDateString());

  console.log(`total logins: ${totalLogins}`);
  console.log(`unique users: ${uniqueLogins}`);
};

main().catch((error) => {
  logger.error('fatal error', serializeError(error));
  process.exitCode = 1;
});

process.on('unhandledRejection', (reason) => {
  logger.error('unhandled rejection', serializeError(reason));
  process.exitCode = 1;
});

process.on('uncaughtException', (error) => {
  logger.error('uncaught exception', serializeError(error));
  process.exitCode = 1;
});

process.on('SIGTERM', () => {
  logger.error('process received SIGTERM');
  process.exitCode = 1;
});
