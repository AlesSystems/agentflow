ALTER TABLE runs ADD COLUMN registration_order INTEGER
 CHECK(registration_order IS NULL OR (typeof(registration_order)='integer' AND registration_order BETWEEN 1 AND 9007199254740991));
WITH ordered AS (SELECT id,row_number() OVER (ORDER BY rowid) AS position FROM runs)
UPDATE runs SET registration_order=(SELECT position FROM ordered WHERE ordered.id=runs.id);
CREATE UNIQUE INDEX runs_registration_order ON runs(registration_order);
CREATE INDEX runs_task_registration ON runs(task_id,registration_order DESC);
CREATE TABLE run_order_allocator (
 singleton INTEGER PRIMARY KEY CHECK(singleton=1),
 last_value INTEGER NOT NULL CHECK(typeof(last_value)='integer' AND last_value BETWEEN 0 AND 9007199254740991)
);
INSERT INTO run_order_allocator VALUES(1,(SELECT coalesce(max(registration_order),0) FROM runs));
CREATE TRIGGER run_order_allocator_no_insert BEFORE INSERT ON run_order_allocator
BEGIN SELECT RAISE(ABORT,'run_order_allocator_singleton'); END;
CREATE TRIGGER run_order_allocator_no_delete BEFORE DELETE ON run_order_allocator
BEGIN SELECT RAISE(ABORT,'run_order_allocator_delete'); END;
CREATE TRIGGER run_order_allocator_advance BEFORE UPDATE ON run_order_allocator
WHEN NEW.singleton IS NOT OLD.singleton OR typeof(NEW.last_value)!='integer'
 OR NEW.last_value<=OLD.last_value OR NEW.last_value>9007199254740991
BEGIN SELECT RAISE(ABORT,'run_order_allocator_advance'); END;
CREATE TRIGGER runs_registration_order_insert BEFORE INSERT ON runs
WHEN NEW.registration_order IS NULL OR typeof(NEW.registration_order)!='integer'
 OR NEW.registration_order<1 OR NEW.registration_order>9007199254740991
 OR NEW.registration_order<=(SELECT last_value FROM run_order_allocator WHERE singleton=1)
BEGIN SELECT RAISE(ABORT,'runs_registration_order_invalid'); END;
CREATE TRIGGER runs_registration_order_immutable BEFORE UPDATE OF registration_order ON runs
WHEN NEW.registration_order IS NOT OLD.registration_order
BEGIN SELECT RAISE(ABORT,'runs_registration_order_immutable'); END;
CREATE TRIGGER runs_registration_order_advance AFTER INSERT ON runs
BEGIN UPDATE run_order_allocator SET last_value=NEW.registration_order WHERE singleton=1; END;
