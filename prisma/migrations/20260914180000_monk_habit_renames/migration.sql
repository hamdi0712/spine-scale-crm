-- Rename the seeded habits.
--
-- Five of the seven default names are changing. This renames the rows that
-- still hold the old default, and only those: the WHERE clause is the whole
-- point of the migration. A habit list is editable, so somebody may already
-- have renamed "No Porn" to something of their own, and a blanket UPDATE would
-- take that away from them.
--
-- Nothing else moves. The ids, the completions behind each habit and their
-- sort order are untouched, so every day already logged stays attached to the
-- habit that earned it.
UPDATE "MonkModeHabit" SET "name" = 'Hold Seed'   WHERE "name" = 'No Porn';
UPDATE "MonkModeHabit" SET "name" = 'Daily Salah' WHERE "name" = 'Salah 5 Times';
UPDATE "MonkModeHabit" SET "name" = 'Meditation'  WHERE "name" = '10 Min Meditation';
UPDATE "MonkModeHabit" SET "name" = 'Deep Work'   WHERE "name" = 'Work On Business';
UPDATE "MonkModeHabit" SET "name" = 'Exercise'    WHERE "name" = '30 Minute Exercise';
