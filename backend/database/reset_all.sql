-- =============================================================================
-- VMS DATABASE FULL RESET SCRIPT
-- Clears ALL data: organizations, units, super admin, all unit databases.
-- Run this from MySQL as root:
--   mysql -u root -p < database/reset_all.sql
-- After running, the system returns to the "first-time setup" state.
-- =============================================================================

-- Step 1: Drop all unit databases (anything named vms_unit_*)
-- We generate DROP DATABASE statements dynamically via stored procedure.

SET FOREIGN_KEY_CHECKS = 0;

DROP PROCEDURE IF EXISTS vms_drop_unit_dbs;

DELIMITER $$
CREATE PROCEDURE vms_drop_unit_dbs()
BEGIN
  DECLARE done INT DEFAULT FALSE;
  DECLARE db_name_var VARCHAR(100);

  DECLARE cur CURSOR FOR
    SELECT SCHEMA_NAME
    FROM information_schema.SCHEMATA
    WHERE SCHEMA_NAME LIKE 'vms_unit_%';

  DECLARE CONTINUE HANDLER FOR NOT FOUND SET done = TRUE;

  OPEN cur;

  read_loop: LOOP
    FETCH cur INTO db_name_var;
    IF done THEN
      LEAVE read_loop;
    END IF;
    SET @drop_sql = CONCAT('DROP DATABASE IF EXISTS `', db_name_var, '`');
    PREPARE stmt FROM @drop_sql;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
    SELECT CONCAT('Dropped database: ', db_name_var) AS status;
  END LOOP;

  CLOSE cur;
END$$
DELIMITER ;

CALL vms_drop_unit_dbs();
DROP PROCEDURE IF EXISTS vms_drop_unit_dbs;

-- Step 2: Clear all data from vms_central tables (preserve schema + lookup data)
USE vms_central;

-- Clear in correct FK order
TRUNCATE TABLE global_audit_logs;
TRUNCATE TABLE public_otp_logs;
TRUNCATE TABLE units;
TRUNCATE TABLE users;
TRUNCATE TABLE organizations;

-- Step 3: Reset auto-increment counters
ALTER TABLE global_audit_logs AUTO_INCREMENT = 1;
ALTER TABLE public_otp_logs   AUTO_INCREMENT = 1;
ALTER TABLE units              AUTO_INCREMENT = 1;
ALTER TABLE users              AUTO_INCREMENT = 1;
ALTER TABLE organizations      AUTO_INCREMENT = 1;

SET FOREIGN_KEY_CHECKS = 1;

-- Done
SELECT '==========================================' AS '';
SELECT 'VMS RESET COMPLETE' AS '';
SELECT 'All units, unit databases, and super admin have been removed.' AS '';
SELECT 'Visit the app to set up your organization and super admin.' AS '';
SELECT '==========================================' AS '';
