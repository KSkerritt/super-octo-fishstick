// Invite-only group registration for unlisted locations: no payment, invoiced separately.
// The page calls this step by step (collector → attachments → members → complete) so group
// size and upload volume are not limited by a single request.
const crypto = require('crypto');

const AIRTABLE_TOKEN   = process.env.AIRTABLE_TOKEN;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;
const ACCESS_KEY       = process.env.CUSTOM_GROUP_KEY;

const TABLES = {
    COLLECTORS: 'Group Collectors',
    MEMBERS:    'Group Members',
};

const ATTACHMENT_FIELDS = new Set(['YUMA Receipt', 'I.D.', 'Autho Letter']);
const ALLOWED_TYPES     = new Set(['image/jpeg', 'image/png', 'application/pdf']);
const MAX_FILE_BYTES    = 4 * 1024 * 1024;
const MAX_GROUP_SIZE    = 500;
const RECORD_ID         = /^rec[A-Za-z0-9]{14}$/;
const ISO_DATE          = /^\d{4}-\d{2}-\d{2}$/;

function reply(statusCode, body) {
    return {
        statusCode,
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
    };
}

function str(value, max = 200) {
    return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function keyMatches(given) {
    if (!ACCESS_KEY || typeof given !== 'string') return false;
    const a = Buffer.from(given);
    const b = Buffer.from(ACCESS_KEY);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function clean(fields) {
    const out = {};
    for (const [k, v] of Object.entries(fields)) {
        if (v !== undefined && v !== null && v !== '') out[k] = v;
    }
    return out;
}

// ── Airtable ─────────────────────────────────────────────────────────────────
const airtableHeaders = () => ({
    Authorization:  `Bearer ${AIRTABLE_TOKEN}`,
    'Content-Type': 'application/json',
});

async function airtableCreate(table, fields) {
    const res = await fetch(
        `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(table)}`,
        {
            method:  'POST',
            headers: airtableHeaders(),
            body:    JSON.stringify({ fields: clean(fields), typecast: true }),
        }
    );
    if (!res.ok) throw new Error(`Airtable error ${res.status} on ${table}: ${await res.text()}`);
    return res.json();
}

async function airtableGet(table, recordId) {
    const res = await fetch(
        `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(table)}/${recordId}`,
        { headers: airtableHeaders() }
    );
    if (!res.ok) throw new Error(`Airtable error ${res.status} reading ${table}: ${await res.text()}`);
    return res.json();
}

async function airtableUploadAttachment(recordId, field, file) {
    const res = await fetch(
        `https://content.airtable.com/v0/${AIRTABLE_BASE_ID}/${recordId}/${encodeURIComponent(field)}/uploadAttachment`,
        {
            method:  'POST',
            headers: airtableHeaders(),
            body:    JSON.stringify({ contentType: file.type, file: file.base64, filename: file.name }),
        }
    );
    if (!res.ok) throw new Error(`Airtable upload error ${res.status} on ${field}: ${await res.text()}`);
}

// ── Mailchimp ────────────────────────────────────────────────────────────────
async function upsertMailchimp(email, mergeFields, tags) {
    const API_KEY = process.env.MAILCHIMP_API_KEY;
    const SERVER  = process.env.MAILCHIMP_SERVER_PREFIX;
    const LIST_ID = process.env.MAILCHIMP_LIST_ID;
    if (!API_KEY || !SERVER || !LIST_ID || !email) return;

    const hash = crypto.createHash('md5').update(email.toLowerCase()).digest('hex');
    const base = `https://${SERVER}.api.mailchimp.com/3.0/lists/${LIST_ID}/members/${hash}`;
    const auth = { Authorization: `apikey ${API_KEY}`, 'Content-Type': 'application/json' };

    const upsertRes = await fetch(base, {
        method:  'PUT',
        headers: auth,
        body:    JSON.stringify({ email_address: email, status_if_new: 'subscribed', merge_fields: mergeFields }),
    });
    if (!upsertRes.ok) {
        console.error('Mailchimp upsert failed:', await upsertRes.text());
        return;
    }

    const tagRes = await fetch(`${base}/tags`, {
        method:  'POST',
        headers: auth,
        body:    JSON.stringify({ tags: tags.map(name => ({ name, status: 'active' })) }),
    });
    if (!tagRes.ok) console.error('Mailchimp tag failed:', await tagRes.text());
}

// ── Twilio WhatsApp ──────────────────────────────────────────────────────────
function toE164(phone) {
    const raw    = String(phone || '').trim();
    const digits = raw.replace(/\D/g, '');
    if (!digits) return '';
    if (raw.startsWith('+'))   return '+' + digits;
    if (digits.length === 10)  return '+1' + digits;     // North American number typed without the 1
    if (digits.length === 7)   return '+1868' + digits;  // Trinidad local number
    return '+' + digits;
}

async function sendWhatsApp(phone, message) {
    const SID   = process.env.TWILIO_ACCOUNT_SID;
    const TOKEN = process.env.TWILIO_AUTH_TOKEN;
    const FROM  = process.env.TWILIO_WHATSAPP_FROM;
    const to    = toE164(phone);
    if (!SID || !TOKEN || !FROM || !to) return;

    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${SID}/Messages.json`, {
        method:  'POST',
        headers: {
            Authorization:  `Basic ${Buffer.from(`${SID}:${TOKEN}`).toString('base64')}`,
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ From: `whatsapp:${FROM}`, To: `whatsapp:${to}`, Body: message }).toString(),
    });
    if (!res.ok) console.error('Twilio WhatsApp failed:', await res.text());
}

// ── Steps ────────────────────────────────────────────────────────────────────
async function createCollector(body) {
    const f         = body.fields || {};
    const groupSize = parseInt(body.groupSize, 10);
    const address   = [f.local_street, f.local_building, f.local_city, f.local_region]
        .map(v => str(v)).filter(Boolean).join(', ');

    const required = { 'first name': f.auth_fname, 'last name': f.auth_lname, email: f.auth_email,
                       'WhatsApp number': f.auth_phone, 'street address': f.local_street, 'city/town': f.local_city };
    const missing = Object.keys(required).filter(k => !str(required[k]));
    if (missing.length) return reply(400, { error: `Please fill in: ${missing.join(', ')}.` });
    if (!(groupSize >= 2 && groupSize <= MAX_GROUP_SIZE)) return reply(400, { error: 'Invalid group size.' });

    const arrival = str(f.event_date, 10);
    const record  = await airtableCreate(TABLES.COLLECTORS, {
        'First Name':                str(f.auth_fname),
        'Last Name':                 str(f.auth_lname),
        'Email':                     str(f.auth_email),
        'Whatsapp Number':           str(f.auth_phone, 40),
        'Secondary Whatsapp Number': str(f.auth_phone_secondary, 40),
        'Arrival Date':              ISO_DATE.test(arrival) ? arrival : undefined,
        'Section':                   str(f.auth_section),
        'Costume Type':              str(f.auth_costume),
        'Drop-off Location':         `Custom: ${address}`,
        'Order Reference No.':       str(f.auth_order_ref),
        'Total Group Size':          groupSize,
        'Payment Status':            'Invoice Pending',
    });
    console.log('Custom group collector created:', record.id, '| size', groupSize);
    return reply(200, { id: record.id });
}

async function createMember(body) {
    const f = body.fields || {};
    if (!RECORD_ID.test(body.collectorId || '')) return reply(400, { error: 'Invalid collector reference.' });
    if (!str(f.fname) || !str(f.lname)) return reply(400, { error: 'Each member needs a first and last name.' });

    const record = await airtableCreate(TABLES.MEMBERS, {
        'First Name':           str(f.fname),
        'Last Name':            str(f.lname),
        'Email':                str(f.email),
        'Section':              str(f.section),
        'Costume Type':         str(f.costume),
        'Order Reference No.':  str(f.order_ref),
        'Authorized Collector': [body.collectorId],
    });

    await Promise.allSettled([
        upsertMailchimp(str(f.email), {
            FNAME:   str(f.fname),
            LNAME:   str(f.lname),
            SECTION: str(f.section),
            TYPE:    str(f.costume),
        }, ['2027', 'Group Member']),
    ]);

    return reply(200, { id: record.id });
}

async function attachFile(body) {
    const file = body.file || {};
    if (!RECORD_ID.test(body.recordId || ''))     return reply(400, { error: 'Invalid record reference.' });
    if (!ATTACHMENT_FIELDS.has(body.field))      return reply(400, { error: 'Invalid upload field.' });
    if (!ALLOWED_TYPES.has(file.type))            return reply(400, { error: 'Files must be JPG, PNG or PDF.' });
    if (typeof file.base64 !== 'string' || !file.base64) return reply(400, { error: 'Empty file.' });
    if (Buffer.byteLength(file.base64, 'base64') > MAX_FILE_BYTES) {
        return reply(400, { error: 'Each file must be 4MB or smaller.' });
    }

    await airtableUploadAttachment(body.recordId, body.field, {
        type:   file.type,
        base64: file.base64,
        name:   str(file.name, 100) || 'upload',
    });
    return reply(200, { ok: true });
}

async function complete(body) {
    if (!RECORD_ID.test(body.collectorId || '')) return reply(400, { error: 'Invalid collector reference.' });

    const c         = (await airtableGet(TABLES.COLLECTORS, body.collectorId)).fields || {};
    const firstName = c['First Name'] || '';
    const address   = String(c['Drop-off Location'] || '').replace(/^Custom:\s*/, '');

    const whatsappMsg =
        `Hi ${firstName}! ✅ Collect Yuh Carnival has received your group registration.\n\n` +
        `👥 Group size: ${c['Total Group Size'] || ''} masquerader(s)\n` +
        `📍 Delivery to: ${address}\n` +
        `🎭 Your section: ${c['Section'] || ''} | Costume: ${c['Costume Type'] || ''}\n` +
        `🧾 We'll send your delivery invoice separately.\n\n` +
        `We'll be in touch with your collection details. — CYC`;

    const comms = [
        upsertMailchimp(c['Email'], {
            FNAME:   firstName,
            LNAME:   c['Last Name']       || '',
            PHONE:   c['Whatsapp Number'] || '',
            SECTION: c['Section']         || '',
            TYPE:    c['Costume Type']    || '',
            DROPOFF: address,
            MMERGE5: 'Invoice Pending',
        }, ['2027', 'group-collector', 'custom-group']),
        sendWhatsApp(c['Whatsapp Number'], whatsappMsg),
    ];
    if (c['Secondary Whatsapp Number']) comms.push(sendWhatsApp(c['Secondary Whatsapp Number'], whatsappMsg));
    await Promise.allSettled(comms);

    console.log('Custom group registration complete:', body.collectorId);
    return reply(200, { ok: true });
}

const STEPS = { collector: createCollector, member: createMember, attach: attachFile, complete };

exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') return reply(405, { error: 'Method not allowed.' });

    if (!ACCESS_KEY) {
        console.error('CUSTOM_GROUP_KEY is not set');
        return reply(503, { error: 'Custom group registration is not available right now.' });
    }

    let body;
    try {
        body = JSON.parse(event.body);
    } catch (e) {
        return reply(400, { error: 'Invalid request.' });
    }

    if (!keyMatches(body.key)) {
        return reply(401, { error: 'This registration link is invalid. Please use the full link sent to you by Collect Yuh Carnival.' });
    }

    const step = STEPS[body.step];
    if (!step) return reply(400, { error: 'Invalid request.' });

    try {
        return await step(body);
    } catch (err) {
        console.error(`Custom group step "${body.step}" failed:`, err.message);
        return reply(502, { error: 'We could not save this part of your registration.' });
    }
};
