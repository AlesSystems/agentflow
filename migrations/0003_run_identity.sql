CREATE TRIGGER runs_id_immutable BEFORE UPDATE OF id ON runs
WHEN NEW.id IS NOT OLD.id
BEGIN SELECT RAISE(ABORT,'runs_id_immutable'); END;
