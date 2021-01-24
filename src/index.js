import https from 'https';
import fs from 'fs';
import dotenv from 'dotenv';


dotenv.config();

const username = process.env.USERNAME;
const password = process.env.PASSWORD;

const token = `Basic ${Buffer.from(username + ':' + password).toString('base64')}`;

let startDate = '2021/01/23';
let endDate = '2021/01/31;'


async function runQuery(term, begin, end) {

    let rsid = '';
    let query = encodeURI(`q="${term}"&from=${begin}&until=${end}`);


    const options = {
        hostname: `myfrontline.loggly.com`,
        path: `/apiv2/search?${query}&size=1000`,
        method: "GET",
        headers: { Authorization : token}
        
    };

    console.log(`searching: https://${options.hostname}${options.path}`);

    const request = new Promise((resolve, reject) => {
        const req = https.request(options, (res) => {

            let data = '';
            console.log(`status: ${res.statusCode}`);
                
            res.on('data', d => {
                data += d.toString();
            });

            res.on('end', () => {
                if (res.statusCode === 200) {
                    rsid = JSON.parse(data).rsid.id;
                    resolve(rsid);
                }
                else {
                    reject({ status: res.statusCode, message: res.statusMessage || 'error'});
                }
            })
        });

        req.end();

        req.on('error', e => {
            reject(e);
        });
    });

    try {
        rsid = await request;
    }
    catch(error) {
        rsid = error;
    }

    return rsid;
}

async function getEvents(rsid, page) {

    let events = '';

    const request = new Promise((resolve, reject) => {

        const req = https.request({
            hostname: "myfrontline.loggly.com",
            port: 443,
            path: `/apiv2/events?rsid=${rsid}&page=${page}`,
            method: "GET",
            headers: { Authorization : token}
        }, res => {
    
            let data ='';
        
    
            res.on('data', d => {
                data += d.toString();
            });
    
            res.on('end', () => {
                if (res.statusCode !== 200) {
                    reject({ status: res.statusCode, message: res.statusMessage || 'error'});
                } else {

                    resolve(JSON.parse(data));
                }
            });
        }); 
        
        req.on('error', e => {
            reject(e);
        });
        
        req.end();
    
    });

    try {
        events = await request;
    }
    catch(error) {
        console.log(error.message);
        events = error;
    }
    
    return events;

};

const getDailyEvents = async (date, username, password) => {


}

(async function() {

    let totalLogins = 0;
    let totalEvents = 0;
    let totalBadEvents = 0;

    let start = '2021/1/1';
    let end = '2021/1/31';

    let endDate = new Date(end);
    endDate.setHours(23,59,59,999);

    let currentDate = new Date(start);
    currentDate.setHours(0,0,0,0);

  
    while (currentDate < endDate) {
        let logins = {};
        let pageData;

        let currentEndDate = new Date(currentDate);
        currentEndDate.setHours(23,59,59,999);

        let rsid = await runQuery("Login Success", currentDate.toISOString(), currentEndDate.toISOString());
        let page = 0;

        console.log(`RSID: ${rsid} start: ${currentDate.toISOString()} end: ${currentEndDate.toISOString()}`);
     
        do {

            try {
                pageData = await getEvents(rsid, page);
            }
            catch (e) {
                console.log(`error: ${JSON.stringify}`);
                throw e;
            }

            console.log(`processing page: ${page}`);
            if (pageData && pageData.events) {
        
                pageData.events.forEach(e => {
    
                    if (e.event.json.Name) {
    
                        let username;
    
                        switch (e.event.json.Name) {
                            case "Local Login Success":
                                username = e.event.json.details.LoginUserName;
                                if (!logins.hasOwnProperty(username)) {
                                    logins[username] = [];
                                }
    
                                totalLogins++;
    
                                break;
                            case "External Login Success":
                                username = `${e.event.json.details.Provider}|${e.event.json.details.ProviderId}`;
                                if (!logins.hasOwnProperty(username)) {
                                    logins[username] = [];
                                }
                                
                                totalLogins++;
                                
                                break;
                            default:
                                console.log(`Unexpected event: ${e.event.json.Name}`);
                                totalBadEvents++;
                                break;
                        }
            
                        if (username) logins[username].push({ timestamp: e.event.json.timestamp, clientID: e.event.json.details.SignInMessage.ClientId });
                        
                    }
                    totalEvents++;
                });
            }
            
            if (!pageData.events) {
                //
                // probably the RSID expired????  run query again and try to reprocess page
                //
                try {
                console.log(pageData);
                console.log(`rsid not found.  get it again: `);
                rsid = await runQuery("Login Success", currentDate.toISOString(), currentEndDate.toISOString());                
                pageData = await getEvents(rsid, page);
                }
                catch(e)
                {
                    console.log(`error: ${JSON.stringify(e)}`);
                }
            }
            else {
                page++;
            }
        
        } while (pageData.events && pageData.events.length > 0);
        

        console.log(`processing day ${currentDate.toISOString()} to ${currentEndDate.toISOString()}`);
        
        let dayFile =  `.\\data\\logins.${currentDate.getFullYear()}_${currentDate.getMonth()+1}_${currentDate.getDate()}.json`;
        fs.writeFileSync(dayFile, JSON.stringify(logins));
    
        console.log(`unique logins: ${Object.keys(logins).length}`);
        console.log(`total logins: ${totalLogins}`);
        console.log(`total events: ${totalEvents}`);
        console.log(`total bad events: ${totalBadEvents}`);

        currentDate.setDate(currentDate.getDate() + 1);

    }

    
    
    
    

})();
