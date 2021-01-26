import fs from 'fs';

(async function() {
    const startDate = new Date('2021/01/01');
    const endDate = new Date('2021/01/31');

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
            if ({}.hasOwnProperty(data, account)) {
                if (!logins.hasOwnProperty(account)) {
                    logins[account] = [];
                    uniqueLogins++;
                }

                data[account].forEach((a) => {
                    // eslint-disable-next-line max-len
                    if (!logins[account].some((l) => (l.timestamp === a.timestamp) && (l.clientId === a.clientId))) {
                        logins[account].push(a);
                        totalLogins++;
                    }
                });
            // logins[account] = logins[account].concat(data[account]);
            }
        }

        currentDate.setDate(currentDate.getDate() + 1);
    }

    // fs.writeFileSync(`..\\data\\logins.total.json`, logins);

    console.log(`unique logins: ${uniqueLogins}`);
    console.log(`total logins: ${totalLogins}`);

    let keyCount = 0;
    for (const account in logins) {
        if (logins.hasOwnProperty(account)) {
            keyCount += logins[account].length;
        }
    }

    console.log(`key count: ${keyCount}`);
})();
