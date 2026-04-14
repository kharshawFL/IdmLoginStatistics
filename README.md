# Overview

The purpose of these scripts are to calculate the number of local (FLID) logins and external (SSO) logins and the number of unique users for some period of time.

## Theory of Operation
Loggly limits the amount of data it'll give you at any time (very annoying) and long time periods will blow node's stack so we pull one day's worth of logs that contain "Login Success."  We keep some properties of interest from each login (username, timestamp and clientId) and build a daily hashtable.  This is a time consuming operation so we stuff it away in a daily file in a `data` directory under the root of he project (you MAY need to create this aheadof time, I didn't test running this without it.)  The script will skip the day if the daily file exists.  if you want to re-run a day, delete daily file.

There is a separate script to consolidate the daily files and perform some totals.

See the anonymous async functions at the bottom of each file for execution entry point.

## Running It
Things to do:
1. Create `data` directory in hte root of the project
1. create an `.env` file with your Loggly username nad password.  See `.env.sample`.  Alternatively set some environment variables.
1. Run `npm install`

Get the loggly logs
`node src/index.js --start 2021/01/01 --end 2021/01/31`

## TTD
- Add winston logging to `consolidateDailyFilesAsync`
- Make `consolidateDailyFilesAsync` async. Or just change the function name
- write events to a database for reporting


# IdmLoginStatistics

## Project Overview
This project sets up a PostgreSQL database and pgAdmin using Docker Compose. The database is named `logins_db`, and it is used to store login statistics.

## Project Structure
```
IdmLoginStatistics
├── docker-compose.yml
├── .env
└── README.md
```

## Getting Started

### Prerequisites
- Docker
- Docker Compose

### Setup Instructions

1. **Clone the Repository**
   Clone this repository to your local machine using:
   ```
   git clone <repository-url>
   ```

2. **Navigate to the Project Directory**
   Change to the project directory:
   ```
   cd IdmLoginStatistics
   ```

3. **Configure Environment Variables**
   Update the `.env` file with your desired database credentials and settings. The default values are provided in the `.env` file.

4. **Start the Services**
   Run the following command to start the PostgreSQL and pgAdmin services:
   ```
   docker-compose up -d
   ```

5. **Access pgAdmin**
   Open your web browser and go to `http://localhost:8080`. Use the credentials specified in the `.env` file to log in.

6. **Connect to PostgreSQL**
   In pgAdmin, create a new server connection using the following details:
   - **Host**: `db` (the service name defined in `docker-compose.yml`)
   - **Port**: `5432`
   - **Username**: The username specified in the `.env` file
   - **Password**: The password specified in the `.env` file

### Stopping the Services
To stop the running services, use:
```
docker-compose down
```

### Additional Information
Refer to the documentation for Docker and Docker Compose for more advanced configurations and options.