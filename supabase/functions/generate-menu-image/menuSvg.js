// Pure SVG builder for the MDA Restaurant menu image (Karachi truck-art / dhaba style).
// No dependencies. Shared by the local preview and the Supabase Edge Function.

const W = 1080;
const C = {
  bg: '#FFF4D6',      // warm cream
  green: '#0B6E4F',
  deepGreen: '#07503A',
  red: '#C8102E',
  maroon: '#7A0F1E',
  gold: '#F2B705',
  orange: '#F26B1D',
  teal: '#12A5A0',
  ink: '#2B1A12',
  grey: '#9A8F85',
};

// Menu sections come from menu_items.category (set by the owner). Known sections keep a fixed order; any new one is added alphabetically.
const CAT_ORDER = ['Burgers', 'Rolls & Sandwiches', 'Fries & Snacks', 'Karahi & Handi', 'Biryani & Rice', 'Bread & Sides', 'Drinks'];
const CAT_COLORS = [C.teal, C.red, C.orange, C.green, C.maroon, C.gold];
const FALLBACK = 'More Items';

const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const fmtPrice = (p) => 'Rs. ' + Number(p).toLocaleString('en-US', { maximumFractionDigits: 0 });

const clip = (s, n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);

function wrap(text, max) {
  const words = String(text).split(' ');
  const lines = [];
  let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > max && cur) { lines.push(cur); cur = w; }
    else cur = (cur + ' ' + w).trim();
  }
  if (cur) lines.push(cur);
  return lines;
}

function group(items) {
  items = items.filter((i) => !i.is_deal);
  const map = new Map();
  for (const it of items) {
    const key = String(it.category || '').trim() || FALLBACK;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(it);
  }
  const rank = (k) => { const i = CAT_ORDER.findIndex((c) => c.toLowerCase() === k.toLowerCase()); return i >= 0 ? i : k === FALLBACK ? 1000 : 500; };
  const keys = [...map.keys()].sort((a, z) => rank(a) - rank(z) || a.localeCompare(z));
  return keys.map((k, i) => ({
    title: k.toUpperCase(),
    icon: CAT_COLORS[i % CAT_COLORS.length],
    items: map.get(k).sort((a, z) => a.name.localeCompare(z.name)),
  }));
}

// A row of truck-art style scallops (half circles) along y, from x0 to x1.
function scallops(x0, x1, y, r, fill, down = true) {
  let d = '';
  for (let x = x0; x + 2 * r <= x1 + 0.1; x += 2 * r) {
    d += `M${x},${y} a${r},${r} 0 0 ${down ? 0 : 1} ${2 * r},0 z `;
  }
  return `<path d="${d}" fill="${fill}"/>`;
}

function diamondsRow(x0, x1, y, step, size, fill) {
  let out = '';
  for (let x = x0; x <= x1; x += step) {
    out += `<path d="M${x},${y - size} l${size},${size} l${-size},${size} l${-size},${-size} z" fill="${fill}"/>`;
  }
  return out;
}

export function buildMenuSvg(rawItems, updatedText) {
  const items = rawItems.filter((i) => !i.is_archived);
  const groups = group(items);
  const deals = items.filter((i) => i.is_deal).sort((a, b) => (a.deal_number || 0) - (b.deal_number || 0));

  const HEADER = 330;
  const ROW = 70;
  const CAT_H = 96;
  const FOOT = 270;

  let body = '';
  let y = HEADER + 20;

  if (deals.length) {
    body += `<g>
      <rect x="60" y="${y}" width="960" height="64" rx="32" fill="${C.red}"/>
      <rect x="66" y="${y + 6}" width="948" height="52" rx="26" fill="none" stroke="${C.gold}" stroke-width="2" stroke-dasharray="6 6"/>
      <path d="M104,${y + 18} l8,14 l-8,14 l-8,-14 z" fill="${C.gold}"/>
      <text x="540" y="${y + 43}" text-anchor="middle" font-family="Yatra One" font-size="34" fill="#fff" letter-spacing="3">SPECIAL DEALS</text>
      <path d="M976,${y + 18} l8,14 l-8,14 l-8,-14 z" fill="${C.gold}"/>
    </g>`;
    y += CAT_H - 14;
    for (const d of deals) {
      const out = d.is_available === false || (d.is_limited && Number(d.stock_qty) <= 0);
      const descLines = wrap(d.deal_description || '', 50);
      let note = '';
      if (d.valid_until) {
        const last = new Date(new Date(d.valid_until).getTime() - 60000);
        note = 'Valid until ' + last.toLocaleDateString('en-GB', { timeZone: 'Asia/Karachi', day: 'numeric', month: 'short' });
      }
      const extra = descLines.length + (note ? 1 : 0);
      const cardH = 64 + extra * 28 + 10;
      const rowY = y;
      const nameColor = out ? C.grey : C.ink;
      const deco = out ? ' text-decoration="line-through"' : '';
      body += `<rect x="72" y="${rowY}" width="936" height="${cardH}" rx="18" fill="#FFE1A8" stroke="${out ? C.grey : C.red}" stroke-width="3" stroke-dasharray="10 6"/>`;
      body += `<text x="100" y="${rowY + 42}" font-family="Poppins" font-weight="700" font-size="30" fill="${nameColor}"${deco}>${esc(clip(d.name, 26))}</text>`;
      body += `<text x="988" y="${rowY + 42}" text-anchor="end" font-family="Poppins" font-weight="700" font-size="34" fill="${out ? C.grey : C.red}"${deco}>${fmtPrice(d.price)}</text>`;
      descLines.forEach((ln, i) => {
        body += `<text x="100" y="${rowY + 76 + i * 28}" font-family="Poppins" font-weight="500" font-size="21" fill="${out ? C.grey : C.maroon}">${esc(ln)}</text>`;
      });
      if (note) {
        body += `<text x="100" y="${rowY + 76 + descLines.length * 28}" font-family="Poppins" font-weight="500" font-size="19" fill="${C.green}">${esc(note)}</text>`;
      }
      if (out) {
        body += `<rect x="640" y="${rowY + 14}" width="146" height="34" rx="17" fill="${C.grey}"/>
        <text x="713" y="${rowY + 38}" text-anchor="middle" font-family="Poppins" font-weight="700" font-size="18" fill="#fff" letter-spacing="1">SOLD OUT</text>`;
      } else if (d.is_limited) {
        body += `<rect x="620" y="${rowY + 14}" width="166" height="34" rx="17" fill="${C.orange}"/>
        <text x="703" y="${rowY + 38}" text-anchor="middle" font-family="Poppins" font-weight="700" font-size="18" fill="#fff" letter-spacing="1">${esc('ONLY ' + Number(d.stock_qty) + ' LEFT')}</text>`;
      }
      const save = Number(d.regular || 0) - Number(d.price);
      if (!out && save > 0) {
        body += `<rect x="808" y="${rowY + 62}" width="180" height="34" rx="17" fill="${C.green}"/>
        <text x="898" y="${rowY + 86}" text-anchor="middle" font-family="Poppins" font-weight="700" font-size="18" fill="${C.gold}" letter-spacing="1">${esc('SAVE ' + fmtPrice(save))}</text>`;
      }
      y += cardH + 14;
    }
    y += 6;
  }

  for (const g of groups) {
    // Category banner
    body += `<g>
      <rect x="60" y="${y}" width="960" height="64" rx="32" fill="${C.green}"/>
      <rect x="66" y="${y + 6}" width="948" height="52" rx="26" fill="none" stroke="${C.gold}" stroke-width="2" stroke-dasharray="6 6"/>
      <circle cx="104" cy="${y + 32}" r="14" fill="${g.icon}" stroke="${C.gold}" stroke-width="3"/>
      <text x="540" y="${y + 43}" text-anchor="middle" font-family="Yatra One" font-size="34" fill="${C.gold}" letter-spacing="3">${esc(g.title)}</text>
      <circle cx="976" cy="${y + 32}" r="14" fill="${g.icon}" stroke="${C.gold}" stroke-width="3"/>
    </g>`;
    y += CAT_H - 14;

    g.items.forEach((it, idx) => {
      const out = it.is_available === false || (it.is_limited && Number(it.stock_qty) <= 0);
      const rowY = y;
      const baseline = rowY + 40;
      const stripe = idx % 2 === 0 ? '#FFE9AE' : 'none';
      body += `<rect x="72" y="${rowY - 2}" width="936" height="${ROW - 8}" rx="14" fill="${stripe}" opacity="0.55"/>`;
      body += `<circle cx="104" cy="${baseline - 10}" r="7" fill="${out ? C.grey : C.red}"/>`;
      const nameColor = out ? C.grey : C.ink;
      const deco = out ? ' text-decoration="line-through"' : '';
      body += `<text x="130" y="${baseline}" font-family="Poppins" font-weight="700" font-size="30" fill="${nameColor}"${deco}>${esc(clip(it.name, 30))}</text>`;

      // price (right aligned)
      body += `<text x="988" y="${baseline}" text-anchor="end" font-family="Poppins" font-weight="700" font-size="32" fill="${out ? C.grey : C.maroon}"${deco}>${fmtPrice(it.price)}</text>`;

      // badge, placed left of the price
      if (out) {
        body += `<rect x="650" y="${rowY + 9}" width="146" height="34" rx="17" fill="${C.grey}"/>
        <text x="723" y="${rowY + 33}" text-anchor="middle" font-family="Poppins" font-weight="700" font-size="18" fill="#fff" letter-spacing="1">SOLD OUT</text>`;
      } else if (it.is_limited) {
        const label = `ONLY ${Number(it.stock_qty)} LEFT`;
        body += `<rect x="640" y="${rowY + 9}" width="166" height="34" rx="17" fill="${C.orange}"/>
        <text x="723" y="${rowY + 33}" text-anchor="middle" font-family="Poppins" font-weight="700" font-size="18" fill="#fff" letter-spacing="1">${esc(label)}</text>`;
      }
      y += ROW;
    });
    y += 14;
  }

  const H = y + FOOT;

  const header = `
    ${scallops(26, W - 26, HEADER - 8, 27, C.gold, true).replace('<path ', '<path transform="translate(0,10)" ')}
    <rect x="26" y="26" width="${W - 52}" height="${HEADER - 34}" fill="${C.green}"/>
    ${scallops(26, W - 26, HEADER - 8, 27, C.green, true)}
    ${diamondsRow(60, W - 60, 62, 60, 12, C.gold)}
    <text x="540" y="178" text-anchor="middle" font-family="Yatra One" font-size="132" fill="${C.gold}" stroke="${C.deepGreen}" stroke-width="3" letter-spacing="8">MDA</text>
    <text x="540" y="244" text-anchor="middle" font-family="Yatra One" font-size="50" fill="#fff" letter-spacing="14">RESTAURANT</text>
    <rect x="300" y="262" width="480" height="4" fill="${C.gold}"/>
    <text x="540" y="304" text-anchor="middle" font-family="Poppins" font-weight="500" font-size="24" fill="${C.gold}" letter-spacing="4">AUTHENTIC KARACHI TASTE</text>`;

  const footerY = y + 10;
  const footer = `
    ${diamondsRow(80, W - 80, footerY + 6, 40, 9, C.red)}
    <rect x="160" y="${footerY + 40}" width="760" height="86" rx="43" fill="${C.red}"/>
    <rect x="168" y="${footerY + 48}" width="744" height="70" rx="35" fill="none" stroke="${C.gold}" stroke-width="3" stroke-dasharray="8 7"/>
    <text x="540" y="${footerY + 94}" text-anchor="middle" font-family="Yatra One" font-size="38" fill="#fff" letter-spacing="3">ORDER ON WHATSAPP</text>
    <text x="540" y="${footerY + 168}" text-anchor="middle" font-family="Poppins" font-weight="500" font-size="22" fill="${C.maroon}">Menu updated: ${esc(updatedText)}</text>
    <text x="540" y="${footerY + 198}" text-anchor="middle" font-family="Poppins" font-weight="500" font-size="19" fill="${C.grey}">Prices in PKR • Availability changes through the day</text>`;

  // Frame (truck-art triple border)
  const frame = `
    <rect x="10" y="10" width="${W - 20}" height="${H - 20}" rx="24" fill="none" stroke="${C.red}" stroke-width="10"/>
    <rect x="26" y="26" width="${W - 52}" height="${H - 52}" rx="16" fill="none" stroke="${C.gold}" stroke-width="4"/>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="${C.bg}"/>
  ${header}
  ${body}
  ${footer}
  ${frame}
</svg>`;
}
