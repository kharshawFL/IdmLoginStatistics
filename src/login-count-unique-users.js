import fs from 'fs';


const getLoginStatsAsync = async (startDateString,
  endDateString, excludeOver) => {
  // verify dates
  const messages = [];

  if (!Date.parse(startDateString)) {
    messages.push(`Invalid start date specified: ${startDate}`);
  }

  if (!Date.parse(endDateString)) {
    messages.push(`Invalid end date specified: ${endDate}`);
  }

  const startDate = new Date(startDateString);
  const endDate = new Date(endDateString);

  const currentDate = new Date(startDate);
  currentDate.setHours(0, 0, 0, 0);


  const logins = [];

  while (currentDate <= endDate) {
    // eslint-disable-next-line max-len
    const filename = `.\\data\\logins.${currentDate.getFullYear()}_${currentDate.getMonth()+1}_${currentDate.getDate()}.json`;

    console.log(`reading ${filename}`);

    const content = fs.readFileSync(filename, 'utf8');
    if (!content) {
      console.error(`File not found or empty: ${filename}`);
      currentDate.setDate(currentDate.getDate() + 1);
      continue;
    }

    const data = JSON.parse(content);

    Object.keys(data).forEach((accountKey) => {
      // console.log(`Processing user: ${accountKey}`);

      const countForDay = Array.isArray(data[accountKey]) ?
        data[accountKey].length : 0;

      if (logins.hasOwnProperty(accountKey)) {
        logins[accountKey] += countForDay;
      } else {
        logins[accountKey] = countForDay;
      }
    });

    currentDate.setDate(currentDate.getDate() + 1);
  }

  if (excludeOver > 0) {
    Object.keys(logins).forEach((key) => {
      if (logins[key] > excludeOver) {
        // console.log(`Excluding user ${key} with ${logins[key]} logins`);
        delete logins[key];
      }
    });
  }

  return {totalLogins: Object.values(logins).reduce((sum, count) =>
    sum + count, 0),
  uniqueLogins: Object.keys(logins).length};
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

  const excludeOverArg = process.argv.indexOf('--exclude-over');
  let excludeOver = 0;

  if (excludeOverArg >= 0) {
    const excludeOverString = process.argv[excludeOverArg+1];

    if (parseInt(excludeOverString) != NaN) {
      excludeOver = parseInt(excludeOverString);
    } else {
      errors.push(`exclude-over must be a valid number`);
    }
  }

  return {startDate, endDate, excludeOver, errors};
};

(async function() {
  const {startDate, endDate, excludeOver, errors} = processCommandLine();

  if (errors.length > 0) {
    errors.forEach((e) => logger.error(e));

    displayUsage(errors);
    return 1;
  }

  const stats = await getLoginStatsAsync(startDate, endDate, excludeOver);

  console.log(`Total logins: ${stats.totalLogins}`);
  console.log(`Unique logins: ${stats.uniqueLogins}`);
})();

