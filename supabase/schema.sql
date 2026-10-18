-- MDA Restaurant WhatsApp ordering assistant: reference schema (Supabase / Postgres).
-- Reconstructed from the live project for documentation. Review constraints, RLS and
-- indexes before running on a new project. Requires extensions: pgvector, pg_net, pg_cron.

create table customers (
  id uuid primary key default gen_random_uuid(),
  wa_id text unique not null,
  name text,
  created_at timestamptz default now()
);

create table menu_items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  price numeric not null,
  category text,                         -- menu section, set by the owner (null for deals)
  stock_qty integer default 50,
  is_available boolean default true,
  is_limited boolean default false,      -- limited items show "only N left" and count down
  is_archived boolean default false,     -- "removed" items are archived, order history stays intact
  is_deal boolean default false,
  deal_number integer,                   -- Deal 1, Deal 2 ...
  deal_description text,
  valid_until timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table deal_items (                -- what is inside a deal
  id uuid primary key default gen_random_uuid(),
  deal_id uuid references menu_items(id),
  menu_item_id uuid references menu_items(id),
  quantity integer not null default 1
);

create table orders (
  id uuid primary key default gen_random_uuid(),
  order_number bigint generated always as identity,
  customer_id uuid references customers(id),
  status text default 'Pending',         -- Pending, Confirmed, Preparing, Out for Delivery, Delivered, Cancelled, Rejected
  fulfillment_type text,                 -- Pickup | Delivery
  delivery_address text, delivery_lat numeric, delivery_lng numeric,
  delivery_fee numeric default 0, subtotal_amount numeric default 0, total_amount numeric default 0,
  delivery_type text,
  created_at timestamptz default now(), updated_at timestamptz default now()
);

create table order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references orders(id),
  menu_item_id uuid references menu_items(id),
  quantity integer not null,
  line_total numeric not null
);

create table order_status_log (id uuid primary key default gen_random_uuid(), order_id uuid, status text, changed_at timestamptz default now());
create table menu_change_log (id bigint generated always as identity primary key, menu_item_id uuid, item_name text, change_type text, old_values jsonb, new_values jsonb, changed_at timestamptz default now());
create table agent_logs (id uuid primary key default gen_random_uuid(), wa_id text, incoming_message text, detected_intent text, reply_sent text, created_at timestamptz default now());
create table error_logs (id uuid primary key default gen_random_uuid(), workflow_name text, workflow_id text, failed_node text, error_message text, execution_url text, created_at timestamptz default now());
create table restaurant_assets (id uuid primary key default gen_random_uuid(), asset_type text, url text, updated_at timestamptz default now());
create table restaurant_info (id uuid primary key default gen_random_uuid(), content text, embedding vector(384), metadata jsonb, created_at timestamptz default now(), updated_at timestamptz default now());

-- ---------------------------------------------------------------- generic helpers
create function set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

create function log_order_status_change() returns trigger language plpgsql as $$
begin
  if (tg_op = 'INSERT') or (old.status is distinct from new.status) then
    insert into order_status_log (order_id, status) values (new.id, new.status);
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------- menu change log -> image refresh
create function log_menu_change() returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if tg_op = 'INSERT' then
    insert into menu_change_log(menu_item_id, item_name, change_type, new_values)
    values (new.id, new.name, 'added', to_jsonb(new));
  elsif tg_op = 'UPDATE' then
    if (to_jsonb(new) - 'updated_at') is distinct from (to_jsonb(old) - 'updated_at') then
      insert into menu_change_log(menu_item_id, item_name, change_type, old_values, new_values)
      values (new.id, new.name,
        case when new.is_archived and not old.is_archived then 'archived'
             when new.price is distinct from old.price then 'price_changed'
             when new.is_available is distinct from old.is_available then 'availability_changed'
             when new.stock_qty is distinct from old.stock_qty then 'stock_changed'
             else 'updated' end,
        to_jsonb(old), to_jsonb(new));
    end if;
  end if;
  return new;
end $$;

-- Calls the n8n webhook that debounces and regenerates the menu image.
-- Replace the URL and secret with your own (keep the secret out of git).
create function notify_menu_image_refresh() returns trigger language plpgsql security definer
set search_path to 'public', 'extensions' as $$
begin
  begin
    perform net.http_post(
      url := 'https://YOUR-N8N-HOST/webhook/menu-image-refresh',
      body := jsonb_build_object('record_id', new.id),
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', 'YOUR_SHARED_SECRET'));
  exception when others then null;  -- never block a menu edit because the webhook failed
  end;
  return new;
end $$;

-- ---------------------------------------------------------------- deals
-- A deal's availability and stock are derived from the items inside it.
create function refresh_deals(p_component uuid default null) returns void language plpgsql security definer set search_path to 'public' as $$
begin
  update menu_items d set is_limited = s.has_limited, stock_qty = s.deal_stock, is_available = s.ok
  from (
    select d2.id,
      exists (select 1 from deal_items di join menu_items c on c.id = di.menu_item_id where di.deal_id = d2.id and c.is_limited) as has_limited,
      coalesce((select min(floor(c.stock_qty::numeric / di.quantity))::int from deal_items di join menu_items c on c.id = di.menu_item_id
                where di.deal_id = d2.id and c.is_limited), 50) as deal_stock,
      (not d2.is_archived and (d2.valid_until is null or d2.valid_until > now())
       and not exists (select 1 from deal_items di join menu_items c on c.id = di.menu_item_id
                       where di.deal_id = d2.id and (not c.is_available or c.is_archived or (c.is_limited and c.stock_qty < di.quantity)))) as ok
    from menu_items d2
    where d2.is_deal and not d2.is_archived
      and (p_component is null or d2.id in (select deal_id from deal_items where menu_item_id = p_component))
  ) s
  where d.id = s.id and (d.is_limited is distinct from s.has_limited or d.stock_qty is distinct from s.deal_stock or d.is_available is distinct from s.ok);
end $$;

create function deals_component_changed() returns trigger language plpgsql security definer set search_path to 'public' as $$
begin perform refresh_deals(new.id); return new; end $$;

-- Ordering a deal reduces the stock of its limited components.
create function deal_decrement_components() returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if exists (select 1 from menu_items where id = new.menu_item_id and is_deal) then
    update menu_items c set stock_qty = greatest(c.stock_qty - s.qty, 0)
    from (select di.menu_item_id as mid, sum(di.quantity * new.quantity)::int as qty
          from deal_items di where di.deal_id = new.menu_item_id group by di.menu_item_id) s
    where c.id = s.mid and c.is_limited;
  end if;
  return new;
end $$;

-- Cancelled / rejected orders give stock back (items and deal components).
create function restore_stock_on_cancel() returns trigger language plpgsql set search_path to 'public' as $$
begin
  if new.status in ('Cancelled','Rejected') and old.status not in ('Cancelled','Rejected') then
    update menu_items m set stock_qty = m.stock_qty + oi.quantity
    from order_items oi where oi.order_id = new.id and oi.menu_item_id = m.id and m.is_limited and not m.is_deal;
    update menu_items c set stock_qty = c.stock_qty + s.qty
    from (select di.menu_item_id as mid, sum(di.quantity * oi.quantity)::int as qty
          from order_items oi join menu_items d on d.id = oi.menu_item_id and d.is_deal
          join deal_items di on di.deal_id = d.id where oi.order_id = new.id group by di.menu_item_id) s
    where c.id = s.mid and c.is_limited;
  end if;
  return new;
end $$;

-- create_deal(p_name, p_price, p_items jsonb, p_valid_until date): called by the owner agent over REST (/rest/v1/rpc/create_deal).
-- It validates items, requires the deal price to be lower than buying separately, numbers the deal and fills deal_items.
-- (Full body lives in the live project; export it with: select pg_get_functiondef('public.create_deal'::regproc);)

-- ---------------------------------------------------------------- triggers
create trigger trg_menu_items_updated_at before update on menu_items for each row execute function set_updated_at();
create trigger trg_orders_updated_at before update on orders for each row execute function set_updated_at();
create trigger trg_log_menu_change after insert or update on menu_items for each row execute function log_menu_change();
create trigger trg_menu_image_refresh after insert on menu_change_log for each row execute function notify_menu_image_refresh();
create trigger trg_log_order_status after insert or update on orders for each row execute function log_order_status_change();
create trigger trg_restore_stock after update of status on orders for each row execute function restore_stock_on_cancel();
create trigger trg_deal_decrement_components after insert on order_items for each row execute function deal_decrement_components();
create trigger trg_deals_component_changed after update of is_available, stock_qty, is_archived, is_limited on menu_items
  for each row when (not new.is_deal) execute function deals_component_changed();

-- ---------------------------------------------------------------- scheduled job: end expired deals
select cron.schedule('expire-menu-deals', '*/5 * * * *', $$
  update public.menu_items set is_archived = true, is_available = false
  where is_deal and not is_archived and valid_until is not null and valid_until < now() $$);
