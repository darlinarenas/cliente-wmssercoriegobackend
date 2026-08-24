-- WMS Serco Riego · aislamiento empresarial aditivo
-- El backend ejecuta esta misma migración automáticamente al iniciar.
-- Este archivo permite auditarla o aplicarla manualmente en una ventana controlada.
BEGIN;

CREATE TABLE IF NOT EXISTS wms_company_meta (
  company_id TEXT PRIMARY KEY,
  revision BIGINT NOT NULL DEFAULT 1,
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  planning JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE sites ADD COLUMN IF NOT EXISTS company_id TEXT NOT NULL DEFAULT 'SERCO_RIEGO';
ALTER TABLE sectors ADD COLUMN IF NOT EXISTS company_id TEXT NOT NULL DEFAULT 'SERCO_RIEGO';
ALTER TABLE racks ADD COLUMN IF NOT EXISTS company_id TEXT NOT NULL DEFAULT 'SERCO_RIEGO';
ALTER TABLE locations ADD COLUMN IF NOT EXISTS company_id TEXT NOT NULL DEFAULT 'SERCO_RIEGO';
ALTER TABLE products ADD COLUMN IF NOT EXISTS company_id TEXT NOT NULL DEFAULT 'SERCO_RIEGO';
ALTER TABLE product_codes ADD COLUMN IF NOT EXISTS company_id TEXT NOT NULL DEFAULT 'SERCO_RIEGO';
ALTER TABLE inventory ADD COLUMN IF NOT EXISTS company_id TEXT NOT NULL DEFAULT 'SERCO_RIEGO';
ALTER TABLE pallets ADD COLUMN IF NOT EXISTS company_id TEXT NOT NULL DEFAULT 'SERCO_RIEGO';
ALTER TABLE receipts ADD COLUMN IF NOT EXISTS company_id TEXT NOT NULL DEFAULT 'SERCO_RIEGO';
ALTER TABLE transfers ADD COLUMN IF NOT EXISTS company_id TEXT NOT NULL DEFAULT 'SERCO_RIEGO';
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS company_id TEXT NOT NULL DEFAULT 'SERCO_RIEGO';
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS company_id TEXT NOT NULL DEFAULT 'SERCO_RIEGO';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS company_id TEXT NOT NULL DEFAULT 'SERCO_RIEGO';
ALTER TABLE movements ADD COLUMN IF NOT EXISTS company_id TEXT NOT NULL DEFAULT 'SERCO_RIEGO';
ALTER TABLE audit ADD COLUMN IF NOT EXISTS company_id TEXT NOT NULL DEFAULT 'SERCO_RIEGO';

UPDATE sites SET company_id=COALESCE(NULLIF(data->>'companyId',''),'SERCO_RIEGO');
UPDATE sectors x SET company_id=COALESCE(NULLIF(x.data->>'companyId',''),s.company_id,x.company_id) FROM sites s WHERE s.id=x.data->>'siteId';
UPDATE racks x SET company_id=COALESCE(NULLIF(x.data->>'companyId',''),s.company_id,x.company_id) FROM sites s WHERE s.id=x.data->>'siteId';
UPDATE locations x SET company_id=COALESCE(NULLIF(x.data->>'companyId',''),s.company_id,x.company_id) FROM sites s WHERE s.id=x.data->>'siteId';
UPDATE pallets x SET company_id=COALESCE(NULLIF(x.data->>'companyId',''),s.company_id,x.company_id) FROM sites s WHERE s.id=x.data->>'siteId';
UPDATE receipts x SET company_id=COALESCE(NULLIF(x.data->>'companyId',''),s.company_id,x.company_id) FROM sites s WHERE s.id=x.data->>'siteId';
UPDATE transfers x SET company_id=COALESCE(NULLIF(x.data->>'companyId',''),s.company_id,x.company_id) FROM sites s WHERE s.id=x.data->>'sourceSiteId';
UPDATE orders x SET company_id=COALESCE(NULLIF(x.data->>'companyId',''),s.company_id,x.company_id) FROM sites s WHERE s.id=x.data->>'sourceSiteId';
UPDATE movements x SET company_id=COALESCE(NULLIF(x.data->>'companyId',''),s.company_id,x.company_id) FROM sites s WHERE s.id=x.data->>'siteId';
UPDATE inventory x SET company_id=COALESCE(NULLIF(x.data->>'companyId',''),l.company_id,x.company_id) FROM locations l WHERE l.id=x.location_id;
UPDATE product_codes x SET company_id=COALESCE(NULLIF(x.data->>'companyId',''),p.company_id,x.company_id) FROM products p WHERE p.id=x.data->>'productId';

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['sites','sectors','racks','locations','products','product_codes','inventory','pallets','receipts','transfers','shipments','tasks','orders','movements','audit'] LOOP
    EXECUTE format('UPDATE %I SET data=jsonb_set(data,''{companyId}'',to_jsonb(company_id),true)',t);
    IF EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid=t::regclass AND contype='p' AND pg_get_constraintdef(oid) NOT ILIKE '%company_id%') THEN
      EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I_pkey',t,t);
      EXECUTE format('ALTER TABLE %I ADD PRIMARY KEY(company_id,id)',t);
    END IF;
  END LOOP;
END $$;

ALTER TABLE products DROP CONSTRAINT IF EXISTS products_code_key;
CREATE UNIQUE INDEX IF NOT EXISTS products_company_code_key ON products(company_id,code);
CREATE INDEX IF NOT EXISTS idx_sites_company ON sites(company_id);
CREATE INDEX IF NOT EXISTS idx_inventory_company_product ON inventory(company_id,product_code);
CREATE INDEX IF NOT EXISTS idx_orders_company ON orders(company_id);
CREATE INDEX IF NOT EXISTS idx_users_company_ids ON users USING GIN(company_ids);

UPDATE users u SET company_ids=COALESCE((SELECT jsonb_agg(DISTINCT a->>'companyId') FROM jsonb_array_elements(u.access_assignments) a WHERE NULLIF(a->>'companyId','') IS NOT NULL),'[]'::jsonb) WHERE u.role<>'ADMIN_GLOBAL' AND jsonb_array_length(u.company_ids)=0;
UPDATE users SET company_ids=jsonb_build_array('SERCO_RIEGO') WHERE role<>'ADMIN_GLOBAL' AND jsonb_array_length(company_ids)=0;
UPDATE users u SET company_ids=jsonb_build_array(u.company_ids->0),access_assignments=COALESCE((SELECT jsonb_agg(a) FROM jsonb_array_elements(u.access_assignments) a WHERE a->>'companyId'=u.company_ids->>0),'[]'::jsonb) WHERE u.role<>'ADMIN_GLOBAL' AND jsonb_array_length(u.company_ids)>1;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_single_company_check;
ALTER TABLE users ADD CONSTRAINT users_single_company_check CHECK (role='ADMIN_GLOBAL' OR jsonb_array_length(company_ids)=1);

INSERT INTO wms_company_meta(company_id,revision,settings,planning)
SELECT c.id,COALESCE(m.revision,1),COALESCE(m.settings,'{}'::jsonb),COALESCE(m.planning,'{}'::jsonb)
FROM companies c CROSS JOIN wms_meta m ON m.id=1 ON CONFLICT(company_id) DO NOTHING;

COMMIT;
