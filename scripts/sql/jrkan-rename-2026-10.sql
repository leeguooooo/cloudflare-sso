-- One-off: display names for the JRKAN → "leeguoo sports" rename (2026-10-25). Ids are unchanged.
-- jrkan-clients.sql never overwrites existing rows, so rows created before the rename need this.
--
--   pnpm wrangler:config:prod
--   npx wrangler d1 execute DB --remote --file=./scripts/sql/jrkan-rename-2026-10.sql
UPDATE tenants SET name = 'leeguoo sports' WHERE id = 'tenant-jrkan' AND name = 'JRKAN';
UPDATE clients SET name = 'leeguoo sports Apple TV', updated_at = strftime('%s', 'now')
  WHERE client_id = 'leeguoo-jrkan-tv' AND name = 'JRKAN Apple TV';
UPDATE clients SET name = 'leeguoo sports iOS/Mac', updated_at = strftime('%s', 'now')
  WHERE client_id = 'leeguoo-jrkan-ios' AND name = 'JRKAN iOS/Mac';
