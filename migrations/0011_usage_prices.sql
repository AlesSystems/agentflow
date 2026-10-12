CREATE TABLE usage_price_snapshots (
 id TEXT PRIMARY KEY NOT NULL,
 name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 200),
 captured_at INTEGER NOT NULL,
 effective_at INTEGER,
 entries TEXT NOT NULL CHECK(json_valid(entries) AND json_type(entries)='array' AND json_array_length(entries) BETWEEN 1 AND 20),
 created_at INTEGER NOT NULL
);
CREATE INDEX usage_prices_history ON usage_price_snapshots(created_at,id);
CREATE TABLE usage_price_entries (
 snapshot_id TEXT NOT NULL REFERENCES usage_price_snapshots(id),
 source TEXT NOT NULL CHECK(length(source) BETWEEN 1 AND 200),
 model TEXT NOT NULL CHECK(length(model) BETWEEN 1 AND 200),
 currency TEXT NOT NULL CHECK(length(currency)=3 AND currency GLOB '[A-Z][A-Z][A-Z]'),
 input_price TEXT,
 output_price TEXT,
 PRIMARY KEY(snapshot_id,source,model)
);
CREATE TRIGGER usage_prices_no_update BEFORE UPDATE ON usage_price_snapshots BEGIN SELECT RAISE(ABORT,'price_immutable'); END;
CREATE TRIGGER usage_prices_no_delete BEFORE DELETE ON usage_price_snapshots BEGIN SELECT RAISE(ABORT,'price_immutable'); END;
CREATE TRIGGER usage_prices_no_replace BEFORE INSERT ON usage_price_snapshots WHEN EXISTS(SELECT 1 FROM usage_price_snapshots WHERE id=NEW.id) BEGIN SELECT RAISE(ABORT,'price_immutable'); END;
CREATE TRIGGER usage_price_entries_no_update BEFORE UPDATE ON usage_price_entries BEGIN SELECT RAISE(ABORT,'price_immutable'); END;
CREATE TRIGGER usage_price_entries_no_delete BEFORE DELETE ON usage_price_entries BEGIN SELECT RAISE(ABORT,'price_immutable'); END;
CREATE TRIGGER usage_price_entries_no_replace BEFORE INSERT ON usage_price_entries WHEN EXISTS(SELECT 1 FROM usage_price_entries WHERE snapshot_id=NEW.snapshot_id AND source=NEW.source AND model=NEW.model) BEGIN SELECT RAISE(ABORT,'price_immutable'); END;
CREATE TRIGGER usage_price_entries_binding BEFORE INSERT ON usage_price_entries WHEN NOT EXISTS(
 SELECT 1 FROM usage_price_snapshots s,json_each(s.entries) e WHERE s.id=NEW.snapshot_id
 AND json_extract(e.value,'$.source')=NEW.source AND json_extract(e.value,'$.model')=NEW.model
 AND json_extract(e.value,'$.currency')=NEW.currency
 AND json_extract(e.value,'$.inputPrice') IS NEW.input_price AND json_extract(e.value,'$.outputPrice') IS NEW.output_price
) BEGIN SELECT RAISE(ABORT,'price_entry_invalid'); END;
