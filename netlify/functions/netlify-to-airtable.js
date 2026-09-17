const AIRTABLE_TOKEN   = process.env.AIRTABLE_TOKEN;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;

const TABLES = {
    INDIVIDUAL: 'Individual Registrations',
    COLLECTORS: 'Group Collectors',
    MEMBERS:    'Group Members',
};

// Netlify stores uploaded files and exposes them as URL strings in the webhook payload.
function attachment(field) {
    if (!field) return undefined;
    const url = typeof field === 'string' ? field : field.url;
    if (!url) return undefined;
    const name = typeof field === 'object' ? field.name : undefined;
    return name ? [{ url, filename: name }] : [{ url }];
}

function clean(fields) {
    const out = {};
    for (const [k, v] of Object.entries(fields)) {
        if (v !== undefined && v !== null && v !== '') out[k] = v;
    }
    return out;
}

async function airtableCreate(table, fields) {
    const res = await fetch(
        `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(table)}`,
        {
            method:  'POST',
            headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' },
            body:    JSON.stringify({ fields: clean(fields) }),
        }
    );
    if (!res.ok) {
        const err = await res.text();
        throw new Error(`Airtable error ${res.status} on ${table}: ${err}`);
    }
    return res.json();
}

// ── Mailchimp ─────────────────────────────────────────────────────────────────
// Upserts the contact into the audience with merge fields, then applies the
// 'cyc-confirmed' tag. Set up a Customer Journey in Mailchimp triggered by
// that tag to send the confirmation email.
async function sendMailchimpConfirmation(email, mergeFields, tags = ['cyc-confirmed', '2027']) {
    const API_KEY = process.env.MAILCHIMP_API_KEY;
    const SERVER  = process.env.MAILCHIMP_SERVER_PREFIX; // e.g. 'us1'
    const LIST_ID = process.env.MAILCHIMP_LIST_ID;
    if (!API_KEY || !SERVER || !LIST_ID || !email) return;

    const crypto = require('crypto');
    const hash   = crypto.createHash('md5').update(email.toLowerCase()).digest('hex');
    const base   = `https://${SERVER}.api.mailchimp.com/3.0/lists/${LIST_ID}/members/${hash}`;
    const auth   = { Authorization: `apikey ${API_KEY}`, 'Content-Type': 'application/json' };

    // Upsert subscriber (status_if_new keeps existing subscribers from being reset)
    const upsertRes = await fetch(base, {
        method:  'PUT',
        headers: auth,
        body:    JSON.stringify({
            email_address: email,
            status_if_new: 'subscribed',
            merge_fields:  mergeFields,
        }),
    });
    if (!upsertRes.ok) {
        console.error('Mailchimp upsert failed:', await upsertRes.text());
        return;
    }

    const allTags = [...new Set(tags)];
    const tagRes  = await fetch(`${base}/tags`, {
        method:  'POST',
        headers: auth,
        body:    JSON.stringify({ tags: allTags.map(name => ({ name, status: 'active' })) }),
    });
    if (!tagRes.ok) console.error('Mailchimp tag failed:', await tagRes.text());
    else console.log('Mailchimp upsert for', email, '| tags:', allTags.join(', '));
}

// ── Twilio WhatsApp ───────────────────────────────────────────────────────────
// Sends a WhatsApp message via the Twilio Messages API.
// phone should be in E.164 format (e.g. +18681234567).
// In production, the message body must match a WhatsApp-approved template.
async function sendWhatsApp(phone, message) {
    const SID   = process.env.TWILIO_ACCOUNT_SID;
    const TOKEN = process.env.TWILIO_AUTH_TOKEN;
    const FROM  = process.env.TWILIO_WHATSAPP_FROM; // e.g. '+14155238886'
    if (!SID || !TOKEN || !FROM || !phone) return;

    // Normalise to E.164: strip all non-digits, prepend + if missing
    const digits    = phone.replace(/\D/g, '');
    const e164      = phone.trim().startsWith('+') ? '+' + digits : '+' + digits;
    const toFormatted = `whatsapp:${e164}`;
    const fromFormatted = `whatsapp:${FROM}`;

    const auth = Buffer.from(`${SID}:${TOKEN}`).toString('base64');
    const res  = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${SID}/Messages.json`, {
        method:  'POST',
        headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body:    new URLSearchParams({ From: fromFormatted, To: toFormatted, Body: message }).toString(),
    });
    if (!res.ok) console.error('Twilio WhatsApp failed:', await res.text());
    else console.log('WhatsApp confirmation sent to', e164);
}

// ── Map functions ─────────────────────────────────────────────────────────────
function mapIndividual(data) {
    const fields = {
        'First Name':          data['First-Name'],
        'Last Name':           data['Last-Name'],
        'Email':               data['E-mail'],
        'Whatsapp Number':     data['Phone-Number'],
        'Street Address':      data['Street'],
        'Building/Apt Number': data['Building'],
        'City':                data['City'],
        'State':               data['State'],
        'Arrival Date':        data['event_date']   || undefined,
        'Section':             data['Section'],
        'Costume Type':        data['Costume Type'],
        'Drop-off Location':   data['Location'],
        'Order Reference No.': data['Order Reference No.'],
        'Payment Status':      'Paid',
    };
    const receipt = attachment(data['Receipt']);
    const id      = attachment(data['Identification']);
    if (receipt) fields['YUMA Receipt'] = receipt;
    if (id)      fields['I.D.']         = id;
    return fields;
}

function mapCollector(data) {
    const fields = {
        'First Name':               data['auth_fname'],
        'Last Name':                data['auth_lname'],
        'Email':                    data['auth_email'],
        'Whatsapp Number':          data['auth_phone'],
        'Secondary Whatsapp Number': data['auth_phone_secondary'],
        'Arrival Date':             data['event_date'] || undefined,
        'Section':                  data['auth_section'],
        'Costume Type':             data['auth_costume'],
        'Drop-off Location':        data['auth_dropoff'],
        'Order Reference No.':      data['auth_order_ref'],
        'Total Group Size':         data['member_count'] ? parseInt(data['member_count']) : undefined,
        'Payment Status':           'Paid',
    };
    const receipt = attachment(data['auth_receipt']);
    const id      = attachment(data['auth_id']);
    const letter  = attachment(data['auth_letter']);
    if (receipt) fields['YUMA Receipt'] = receipt;
    if (id)      fields['I.D.']         = id;
    if (letter)  fields['Autho Letter'] = letter;
    return fields;
}

function mapMember(data, i, collectorRecordId) {
    const fields = {
        'First Name':           data[`member${i}_fname`],
        'Last Name':            data[`member${i}_lname`],
        'Email':                data[`member${i}_email`],
        'Section':              data[`member${i}_section`],
        'Costume Type':         data[`member${i}_costume`],
        'Order Reference No.':  data[`member${i}_order_ref`],
        'Authorized Collector': [collectorRecordId],
    };
    const receipt = attachment(data[`member${i}_receipt`]);
    const id      = attachment(data[`member${i}_id`]);
    if (receipt) fields['YUMA Receipt'] = receipt;
    if (id)      fields['I.D.']         = id;
    return fields;
}

exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method not allowed' };
    }

    let payload;
    try {
        payload = JSON.parse(event.body);
    } catch (e) {
        return { statusCode: 400, body: 'Invalid JSON' };
    }

    const formName = payload.form_name;
    const data     = payload.data || {};

    // Drop honeypot-triggered spam
    if (data['bot-field']) {
        console.log('Honeypot triggered — skipping');
        return { statusCode: 200, body: 'OK' };
    }

    try {
        if (formName === 'Registration') {
            await airtableCreate(TABLES.INDIVIDUAL, mapIndividual(data));
            console.log('Individual registration written to Airtable');

            const total     = data['wipay_total_paid'] || '';
            const firstName = data['First-Name']       || '';
            const lastName  = data['Last-Name']        || '';
            const section   = data['Section']          || '';
            const costume   = data['Costume Type']     || '';
            const location  = data['Location']         || '';
            const phone     = data['Phone-Number']     || '';
            const email     = data['E-mail']           || '';

            const whatsappMsg =
                `Hi ${firstName}! ✅ Collect Yuh Carnival has received your registration.\n\n` +
                `📍 Drop-off: ${location}\n` +
                `🎭 Section: ${section} | Costume: ${costume}\n` +
                `💰 Delivery fee paid: $${total} USD\n\n` +
                `We'll be in touch with your collection details. — CYC`;

            await Promise.allSettled([
                sendMailchimpConfirmation(email, {
                    FNAME:   firstName,
                    LNAME:   lastName,
                    PHONE:   phone,
                    SECTION: section,
                    TYPE:    costume,
                    DROPOFF: location,
                    AMTPAID: total ? `$${total} USD` : '',
                    MMERGE5: 'Paid',
                }, ['cyc-confirmed', '2027']),
                sendWhatsApp(phone, whatsappMsg),
            ]);

        } else if (formName === 'Group Registration') {
            // 1. Create the collector record first to get its Airtable record ID
            const collectorRecord = await airtableCreate(TABLES.COLLECTORS, mapCollector(data));
            const collectorId     = collectorRecord.id;
            console.log('Group collector created:', collectorId);

            // 2. Create all member records in parallel, linked to the collector
            const memberSlots = [];
            for (let i = 1; i <= 9; i++) {
                if (data[`member${i}_fname`]) memberSlots.push(i);
            }
            await Promise.all(memberSlots.map(i =>
                airtableCreate(TABLES.MEMBERS, mapMember(data, i, collectorId))
                    .then(() => console.log(`Member ${i} created`))
            ));
            console.log(`Group complete: 1 collector + ${memberSlots.length} member(s)`);

            // 3. Add members to Mailchimp audience for marketing (non-fatal)
            await Promise.allSettled(memberSlots
                .filter(i => data[`member${i}_email`])
                .map(i => sendMailchimpConfirmation(
                    data[`member${i}_email`],
                    {
                        FNAME:   data[`member${i}_fname`]    || '',
                        LNAME:   data[`member${i}_lname`]    || '',
                        SECTION: data[`member${i}_section`]  || '',
                        TYPE:    data[`member${i}_costume`]  || '',
                    },
                    ['2027', 'Group Member']
                ))
            );

            const total      = data['wipay_total_paid']  || '';
            const firstName  = data['auth_fname']        || '';
            const lastName   = data['auth_lname']        || '';
            const section    = data['auth_section']      || '';
            const costume    = data['auth_costume']      || '';
            const location   = data['auth_dropoff']      || '';
            const phone      = data['auth_phone']        || '';
            const phone2     = data['auth_phone_secondary'] || '';
            const email      = data['auth_email']        || '';
            const groupSize  = data['member_count']      || '';

            const whatsappMsg =
                `Hi ${firstName}! ✅ Collect Yuh Carnival has received your group registration.\n\n` +
                `👥 Group size: ${groupSize} masquerader(s)\n` +
                `📍 Drop-off: ${location}\n` +
                `🎭 Your section: ${section} | Costume: ${costume}\n` +
                `💰 Delivery fee paid: $${total} USD\n\n` +
                `We'll be in touch with your collection details. — CYC`;

            const commsPromises = [
                sendMailchimpConfirmation(email, {
                    FNAME:   firstName,
                    LNAME:   lastName,
                    PHONE:   phone,
                    SECTION: section,
                    TYPE:    costume,
                    DROPOFF: location,
                    AMTPAID: total ? `$${total} USD` : '',
                    MMERGE5: 'Paid',
                }, ['cyc-confirmed', '2027', 'group-collector']),
                sendWhatsApp(phone, whatsappMsg),
            ];
            if (phone2) commsPromises.push(sendWhatsApp(phone2, whatsappMsg));

            await Promise.allSettled(commsPromises);

        } else {
            console.log('Unrecognised form name:', formName);
        }
    } catch (err) {
        console.error('Airtable write failed:', err.message);
        return { statusCode: 500, body: err.message };
    }

    return { statusCode: 200, body: 'OK' };
};
