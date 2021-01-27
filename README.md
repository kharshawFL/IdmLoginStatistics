# Overview

The purpose of these scripts are to calculate the number of local (FLID) logins and external (SSO) logins and the number of unique users for some period of time.

## Theory of Operation
Loggly limits the amount of data it'll give you at any time (very annoying) and long time periods will blow node's stack so we pull one day's worth of logs that contain "Login Success."  We keep some properties of interest from each login (username, timestamp and clientId) and build a daily hashtable.  This is a time consuming operation so we stuff it away in a daily file in a `data` directory under the root of he project (you MAY need to create this aheadof time, I didn't test running this without it.)  The script will skip the day if the daily file exists.  if you want to re-run a day, delete daily file.

There is a separate script to consolidate the daily files and perform some totals.

## Running It
Things to do:
1. Create `data` directory in hte root of the project
1. create an `.env` file with your Loggly username nad password.  See `.env.sample`.  Alternatively set some environment variables.

Get the loggly logs
`node src/index.js --start 2021/01/01 --end 2021/01/31`

Calculate the numbers
`node .\process-daily-files.js`

I got lazy here. The dates are hard coded here.  

## TTD
- Import the `consolidateDailyFilesAsync` into `index` and run the calculations from the main script
- Add winston logging to `consolidateDailyFilesAsync
- Make `consolidateDailyFilesAsync` async. Or just change the function name
