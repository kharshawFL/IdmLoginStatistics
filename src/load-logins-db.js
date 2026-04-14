#!/usr/bin/env node
/* eslint-disable max-len */

// Load required modules
import fs from 'node:fs/promises';
import path from 'path';
import pg from 'pg';

const {Client} = pg;

import dotenv from 'dotenv';
dotenv.config();

// Main async function to run our tasks

async function main() {
  // Validate command-line arguments (expects a data directory path)
  const args = process.argv.slice(2);
  if (args.length < 1) {
    console.error('Usage: node load_logins-db.js /path/to/datafiles [filename] --summaryOnly');
    process.exit(1);
  }
  const dataDir = args[0];
  const specificFile = args[1]; // Optional argument for a specific file

  const summaryOnly = args.includes('--summaryOnly'); // Optional flag for summary only
  if (summaryOnly) {
    console.log('Summary only mode is enabled. Only summary data will be processed.');
  }

  // Configure the PostgreSQL client using environment variables or defaults.
  const pgClient = new Client({
    user: process.env.PGUSER || 'postgres',
    host: process.env.PGHOST || 'localhost',
    database: process.env.PGDATABASE || 'logins_db',
    password: process.env.PGPASSWORD || '',
    port: process.env.PGPORT ? parseInt(process.env.PGPORT, 10) : 5432,
  });

  try {
    // Connect to the database
    await pgClient.connect();

    await createDatabaseTables(pgClient);

    let files = await getFilesToLoad(specificFile, dataDir);

    const filenamePattern = /^logins\.(\d{4})_(\d{1,2})_(\d{1,2})\.json$/;
    const jsonFiles = files.filter((file) => filenamePattern.test(file));

    // Process each file matching the naming convention.
    for (const fileName of jsonFiles) {

      if (!summaryOnly) {
        let isFileProcessed = true;

        // Check if this file has already been processed.
        isFileProcessed = await checkIfFileProcessed(pgClient, fileName);

        if (isFileProcessed) {
          continue;
        }
      }

      console.log(`Processing file: ${fileName}`);
      const filePath = path.join(dataDir, fileName);

      try {
        // Read and parse the JSON file.
        const fileContent = await fs.readFile(filePath, 'utf8');
        const data = JSON.parse(fileContent);

        /*
                  Iterate over each user in the JSON object.
                  Each key is a username, and the value is
                  an array of login attempt objects.
                */
        for (const [username, attempts] of Object.entries(data)) {
          if (!Array.isArray(attempts)) {
            // eslint-disable-next-line max-len
            console.warn(`Skipping invalid data for user ${username} in file ${fileName}`);
            continue;
          }

          // get the date from the first attempt
          const attemptDate = attempts[0].timestamp || new Date().toISOString().split('T')[0];

          await pgClient.query(
            // eslint-disable-next-line max-len
            `INSERT INTO logins_summary (username, login_attempts, attempt_date)
              VALUES ($1, $2, $3)
              ON CONFLICT (username, attempt_date) DO NOTHING`,
            [username, attempts.length, attemptDate],
          );

          if (!summaryOnly) {
            // Process each login attempt for the user.
            for (const attempt of attempts) {
              attempt.clientID = attempt.clientID || 'Unknown';

              /*
                            Validate that the attempt object contains
                            both a timestamp and a clientId.
                          */
              if (!attempt.timestamp || !attempt.clientID) {
                // eslint-disable-next-line max-len
                console.warn(`Skipping invalid attempt for user ${username} in file ${fileName}`);
                continue;
              }

              // Convert the timestamp to a JavaScript Date object.
              const attemptTime = new Date(attempt.timestamp);

              /*
                            Insert the login attempt. If there is
                            a duplicate (same username and timestamp),
                            the ON CONFLICT clause prevents a duplicate entry.
                          */
              await pgClient.query(
                // eslint-disable-next-line max-len
                `INSERT INTO logins (username, attempt_time, client_id)
                                VALUES ($1, $2, $3)
                                ON CONFLICT (username, attempt_time) DO NOTHING`,
                [username, attemptTime, attempt.clientID],
              );
            }
          }
        }
        // Log the file as processed
        await pgClient.query(
          'INSERT INTO processed_files (filename) VALUES ($1)',
          [fileName],
        );
      } catch (err) {
        console.error(`Error processing file ${fileName}:`, err);
        /*
          If errors occur during processing,
          the file is not marked as processed.
        */
      }
    }

    console.log('Data loading complete.');
  } catch (err) {
    // eslint-disable-next-line max-len
    console.error('Error connecting to the database or during processing:', err);
  } finally {
    // Ensure the database connection is closed.
    await pgClient.end();
  }
}

// Run the main function and catch any unhandled errors.
main().catch((err) => {
  console.error('Unhandled error:', err);
  process.exit(1);
});


async function checkIfFileProcessed(pgClient, fileName) {
  let isFileProcessed = false;
  const { rows } = await pgClient.query(
    'SELECT filename FROM processed_files WHERE filename = $1',
    [fileName]
  );
  if (rows.length > 0) {
    console.log(`Skipping already processed file: ${fileName}`);
    isFileProcessed = true;
  }
  return isFileProcessed;
}

async function getFilesToLoad(specificFile, dataDir) {
  let files = [];
  if (specificFile) {
    // If a specific file is provided, validate its existence
    const specificFilePath = path.join(dataDir, specificFile);
    try {
      await fs.access(specificFilePath); // Check if the file exists
      files.push(specificFile);
    } catch (err) {
      // eslint-disable-next-line max-len
      console.error(`Specified file does not exist: ${specificFilePath}`);
      process.exit(1);
    }
  } else {
    // Read all files from the provided directory
    files = await fs.readdir(dataDir);
  }
  return files.sort();
}

async function createDatabaseTables(pgClient) {
  /*
      Create the `logins` table to store login attempts.
  */
  await pgClient.query(`
          CREATE TABLE IF NOT EXISTS logins (
            id SERIAL PRIMARY KEY,
            username TEXT NOT NULL,
            attempt_time TIMESTAMP NOT NULL,
            client_id TEXT NOT NULL,
            UNIQUE (username, attempt_time)
          );
        `);

  await pgClient.query(`
          CREATE TABLE IF NOT EXISTS logins_summary (
            id SERIAL PRIMARY KEY,
            username TEXT NOT NULL,
            login_attempts INTEGER NOT NULL,
            attempt_date TIMESTAMP NOT NULL,
            UNIQUE (username, attempt_date)
          );
        `);

  /*
        Create the `processed_files` table to log
        filenames of successfully processed datafiles.
      */
  await pgClient.query(`
          CREATE TABLE IF NOT EXISTS processed_files (
            filename TEXT PRIMARY KEY,
            processed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          );
        `);
}

