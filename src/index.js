import https from 'https';
import fs from 'fs';
import dotenv from 'dotenv';
import winston from 'winston';

dotenv.config();

const logger = winston.createLogger({
    level: 'info',
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

async function runQueryAsync(term, begin, end, token) {
    let rsid = '';
    const query = encodeURI(`q="${term}"&from=${begin}&until=${end}`);


    const options = {
        hostname: `myfrontline.loggly.com`,
        path: `/apiv2/search?${query}&size=1000`,
        method: 'GET',
        headers: {Authorization: token},

    };

    console.log(`searching: https://${options.hostname}${options.path}`);

    const request = new Promise((resolve, reject) => {
        const req = https.request(options, (res) => {
            let data = '';
            console.log(`status: ${res.statusCode}`);

            res.on('data', (d) => {
                data += d.toString();
            });

            res.on('end', () => {
                if (res.statusCode === 200) {
                    rsid = JSON.parse(data).rsid.id;
                    resolve(rsid);
                } else {
                    // eslint-disable-next-line max-len
                    reject(new Error({status: res.statusCode, message: res.statusMessage || 'error'}));
                }
            });
        });

        req.end();

        req.on('error', (e) => {
            reject(e);
        });
    });

    try {
        rsid = await request;
    } catch (error) {
        rsid = error;
    }

    return rsid;
}

async function getEventsAsync(rsid, page, token) {
    let events = '';

    const request = new Promise((resolve, reject) => {
        const req = https.request({
            hostname: 'myfrontline.loggly.com',
            port: 443,
            path: `/apiv2/events?rsid=${rsid}&page=${page}`,
            method: 'GET',
            headers: {Authorization: token},
        }, (res) => {
            let data ='';


            res.on('data', (d) => {
                data += d.toString();
            });

            res.on('end', () => {
                if (res.statusCode !== 200) {
                    // eslint-disable-next-line max-len
                    reject(new Error({status: res.statusCode, message: res.statusMessage || 'error'}));
                } else {
                    resolve(JSON.parse(data));
                }
            });
        });

        req.on('error', (e) => {
            reject(e);
        });

        req.end();
    });

    try {
        events = await request;
    } catch (error) {
        console.log(error.message);
        events = error;
    }

    return events;
};

const getDailyEventsAsync = async (dateToProcess, token) => {
    const dateToProcessEnd = new Date(dateToProcess);
    dateToProcessEnd.setHours(23, 59, 59, 999);

    let rsid = await runQueryAsync('Login Success',
        dateToProcess.toISOString(),
        dateToProcessEnd.toISOString(), token);
    let page = 0;

    // eslint-disable-next-line max-len
    logger.info(`RSID: ${rsid} start: ${dateToProcess.toISOString()} end: ${dateToProcessEnd.toISOString()}`);

    let pageData;

    const logins = {};

    do {
        try {
            pageData = await getEventsAsync(rsid, page, token);
        } catch (e) {
            logger.error(e);
            logger.info(`getEvents error: ${JSON.stringify}`);
            throw e;
        }

        console.log(`processing page: ${page}`);
        if (pageData && pageData.events) {
            pageData.events.forEach((e) => {
                if (e.event.json.Name) {
                    let username;

                    switch (e.event.json.Name) {
                    case 'Local Login Success':
                        username = e.event.json.details.LoginUserName;
                        if (!logins.hasOwnProperty(username)) {
                            logins[username] = [];
                        }

                        break;
                    case 'External Login Success':
                        // eslint-disable-next-line max-len
                        username = `${e.event.json.details.Provider}|${e.event.json.details.ProviderId}`;
                        if (!logins.hasOwnProperty(username)) {
                            logins[username] = [];
                        }

                        break;
                    default:
                        logger.warn(`Unexpected event: ${e.event.json.Name}`);
                        break;
                    }

                    // eslint-disable-next-line max-len
                    if (username) logins[username].push({timestamp: e.event.json.timestamp, clientID: e.event.json.details.SignInMessage.ClientId});
                }
            });

            page++;
        } else {
            logger.debug(pageData);
            logger.info(`rsid not found.  get it again `);
            //
            // probably the RSID expired????
            // run query again and try to reprocess page
            //
            try {
                rsid = await runQueryAsync('Login Success',
                    dateToProcess.toISOString(),
                    dateToProcessEnd.toISOString(), token);
            } catch (e) {
                logger.error(e);
            }
        }
    } while (pageData.events && pageData.events.length > 0);

    return logins;
};

const getAuthTokenFromEnvironment = () => {
    const username = process.env.LOGGLY_USERNAME || '';
    const password = process.env.LOGGLY_PASSWORD || '';


    if (!username.length || !password.length) {
        // eslint-disable-next-line max-len
        const message = 'The environment must specify LOGGLY_USERNAME and LOGGLY_PASSWORD';
        logger.warn(message);
        throw (message);
    }

    return `Basic ${Buffer.from(username + ':' + password).toString('base64')}`;
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

(async function() {
    const {startDate, endDate, errors} = processCommandLine();

    if (errors.length > 0) {
        errors.forEach((e) => logger.error(e));

        displayUsage(errors);
        return 1;
    }

    endDate.setHours(23, 59, 59, 999);
    startDate.setHours(0, 0, 0, 0);

    const token = getAuthTokenFromEnvironment();

    // eslint-disable-next-line max-len
    logger.info(`start:\t${startDate.toString()} \r\nend:\t${endDate.toString()} \r\ntoken:\t${token}`);

    const currentDate = new Date(startDate);

    while (currentDate < endDate) {
        let logins = {};

        // eslint-disable-next-line max-len
        const dayFile = `..\\data\\logins.${currentDate.getFullYear()}_${currentDate.getMonth()+1}_${currentDate.getDate()}.json`;

        if (!fs.existsSync(dayFile)) {
            logins = await getDailyEventsAsync(currentDate, token);

            // eslint-disable-next-line max-len
            logger.info(`processing day ${currentDate.toISOString()} to ${currentEndDate.toISOString()}`);

            fs.writeFileSync(dayFile, JSON.stringify(logins));
        } else {
            logger.info(`outfile exists for ${currentDate.toISOString()}`);
        }

        currentDate.setDate(currentDate.getDate() + 1);
    };
})();
