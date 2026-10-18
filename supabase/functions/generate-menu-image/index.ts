import { initWasm, Resvg } from 'npm:@resvg/resvg-wasm@2.6.2';
import { buildMenuSvg } from './menuSvg.js';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const BUCKET = 'restaurant-assets';
const OBJECT_PATH = 'auto-menu/mda-menu.png';

const FONT_URLS = [
  'https://raw.githubusercontent.com/google/fonts/main/ofl/poppins/Poppins-Bold.ttf',
  'https://raw.githubusercontent.com/google/fonts/main/ofl/poppins/Poppins-Medium.ttf',
  'https://raw.githubusercontent.com/google/fonts/main/ofl/yatraone/YatraOne-Regular.ttf',
];

let ready: Promise<Uint8Array[]> | null = null;
function init() {
  if (!ready) {
    ready = (async () => {
      const wasm = await fetch('https://unpkg.com/@resvg/resvg-wasm@2.6.2/index_bg.wasm');
      await initWasm(wasm);
      return await Promise.all(
        FONT_URLS.map(async (u) => {
          const r = await fetch(u);
          if (!r.ok) throw new Error('font fetch failed ' + u + ' ' + r.status);
          return new Uint8Array(await r.arrayBuffer());
        }),
      );
    })().catch((e) => {
      ready = null;
      throw e;
    });
  }
  return ready;
}

const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };

Deno.serve(async (_req) => {
  try {
    const fonts = await init();

    const q = await fetch(
      `${SUPABASE_URL}/rest/v1/menu_items?select=id,name,price,category,is_available,is_limited,stock_qty,is_archived,is_deal,deal_number,deal_description,valid_until&is_archived=eq.false&order=name`,
      { headers: H },
    );
    if (!q.ok) throw new Error('menu query failed ' + q.status + ' ' + (await q.text()));
    const items = await q.json();

    // regular (separate) price of each deal, so the image can show the saving
    const dq = await fetch(
      `${SUPABASE_URL}/rest/v1/deal_items?select=deal_id,quantity,item:menu_items!deal_items_menu_item_id_fkey(price)`,
      { headers: H },
    );
    if (dq.ok) {
      const rows = await dq.json();
      const regular: Record<string, number> = {};
      for (const r of rows) {
        regular[r.deal_id] = (regular[r.deal_id] || 0) + Number(r.quantity) * Number(r.item?.price || 0);
      }
      for (const it of items) if (it.is_deal) it.regular = regular[it.id] || 0;
    }

    const updatedText = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Karachi', day: 'numeric', month: 'short', year: 'numeric',
      hour: 'numeric', minute: '2-digit', hour12: true,
    }).format(new Date()).replace(/ (am|pm)$/i, (m) => m.toUpperCase());

    const svg = buildMenuSvg(items, updatedText);
    const resvg = new Resvg(svg, {
      font: { fontBuffers: fonts, loadSystemFonts: false, defaultFontFamily: 'Poppins' },
    });
    const png = resvg.render().asPng();

    const up = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${OBJECT_PATH}`, {
      method: 'POST',
      headers: { ...H, 'Content-Type': 'image/png', 'x-upsert': 'true', 'cache-control': 'max-age=60' },
      body: png,
    });
    if (!up.ok) throw new Error('upload failed ' + up.status + ' ' + (await up.text()));

    const url = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${OBJECT_PATH}?v=${Date.now()}`;
    const now = new Date().toISOString();

    const patch = await fetch(`${SUPABASE_URL}/rest/v1/restaurant_assets?asset_type=eq.menu_image`, {
      method: 'PATCH',
      headers: { ...H, 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify({ url, updated_at: now }),
    });
    if (!patch.ok) throw new Error('asset update failed ' + patch.status + ' ' + (await patch.text()));
    const rows = await patch.json();
    if (!rows.length) {
      const ins = await fetch(`${SUPABASE_URL}/rest/v1/restaurant_assets`, {
        method: 'POST',
        headers: { ...H, 'Content-Type': 'application/json' },
        body: JSON.stringify({ asset_type: 'menu_image', url }),
      });
      if (!ins.ok) throw new Error('asset insert failed ' + ins.status + ' ' + (await ins.text()));
    }

    return new Response(JSON.stringify({ ok: true, url, items: items.length, deals: items.filter((i: any) => i.is_deal).length, bytes: png.length }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ ok: false, error: String(e?.message ?? e) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
