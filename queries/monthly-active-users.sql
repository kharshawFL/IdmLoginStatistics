WITH monthly_user_logins AS (
  SELECT
    date_trunc('month', attempt_date)::date AS month,
    username,
    SUM(login_attempts) AS total_logins
  FROM logins_summary
  WHERE attempt_date >= TIMESTAMP '2025-01-01 00:00:00'
    AND attempt_date <  TIMESTAMP '2026-01-01 00:00:00'
  GROUP BY 1, 2
),
bots AS (
  SELECT month, username
  FROM monthly_user_logins
  WHERE total_logins > 500
),
filtered AS (
  SELECT m.*
  FROM monthly_user_logins m
  LEFT JOIN bots b
    ON b.month = m.month AND b.username = m.username
  WHERE b.username IS NULL
)
SELECT
  month,
  COUNT(DISTINCT username) AS distinct_users,
  SUM(total_logins) AS total_logins
FROM filtered
GROUP BY 1
ORDER BY 1;