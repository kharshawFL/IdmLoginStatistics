import fs from 'fs';


const consolidateDailyFilesAsync = async (startDateString, endDateString) => {
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


    const logins = {};
    let totalLogins = 0;
    let uniqueLogins = 0;

    while (currentDate <= endDate) {
        // eslint-disable-next-line max-len
        const filename = `..\\data\\logins.${currentDate.getFullYear()}_${currentDate.getMonth()+1}_${currentDate.getDate()}.json`;

        console.log(`reading ${filename}`);

        const data = JSON.parse(fs.readFileSync(filename));

        for (const account in data) {
            if (data.hasOwnProperty(account)) {
                if (!logins.hasOwnProperty(account)) {
                    logins[account] = [];
                    uniqueLogins++;
                }

                data[account].forEach((a) => {
                    /*
                        i'm lazy.  getting the daily files takes a long time.
                        the initial pull from Loggly had a bug and some
                        events were duplicated, skip the dups here
                    */
                    // eslint-disable-next-line max-len
                    if (!logins[account].some((l) => (l.timestamp === a.timestamp) && (l.clientId === a.clientId))) {
                        logins[account].push(a);
                        totalLogins++;
                    }
                });
            }
        }

        currentDate.setDate(currentDate.getDate() + 1);
    }

    return {totalLogins, uniqueLogins, logins};
};

export {consolidateDailyFilesAsync};
