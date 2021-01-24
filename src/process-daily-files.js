import fs from 'fs';

(async function() {

    let startDate = new Date('2021/01/01');
    let endDate = new Date('2021/01/31');

    let currentDate = new Date(startDate);
    currentDate.setHours(0,0,0,0);

    var logins = {};
    var totalLogins = 0;
    var uniqueLogins = 0;

    while (currentDate <= endDate) {

        let filename = `..\\data\\logins.${currentDate.getFullYear()}_${currentDate.getMonth()+1}_${currentDate.getDate()}.json`;

        console.log(`reading ${filename}`);

        const data = JSON.parse(fs.readFileSync(filename));
    
        for(const account in data) {
            if (!logins.hasOwnProperty(account)) {
                logins[account] = [];
                uniqueLogins++;    
            }

            data[account].forEach(a => {
                if (!logins[account].some(l => (l.timestamp === a.timestamp) && (l.clientId === a.clientId))) {
                    logins[account].push(a);
                    totalLogins++
                }
            });
            //logins[account] = logins[account].concat(data[account]);
        }
        
        currentDate.setDate(currentDate.getDate() + 1);
    }

    //fs.writeFileSync(`..\\data\\logins.total.json`, logins);

    console.log(`unique logins: ${uniqueLogins}`);
    console.log(`total logins: ${totalLogins}`);

    var keyCount = 0;
    for (const account in logins) {
        if (logins.hasOwnProperty(account)){

            keyCount += logins[account].length;
        }
    }

    console.log(`key count: ${keyCount}`);


})();