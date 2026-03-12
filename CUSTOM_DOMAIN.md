# Adding Custom Domain to PiPilot Search API

Guide to point `api.pipilot.dev` to your Cloudflare Worker while keeping `pipilot.dev` on Vercel.

---

## ✅ Recommended: Cloudflare DNS + Vercel Hosting

**This setup:**
- DNS managed by Cloudflare (free, fast)
- `pipilot.dev` still hosted on Vercel
- `api.pipilot.dev` points to Cloudflare Worker
- Free SSL for both

---

## Step-by-Step Guide

### 1. Add Domain to Cloudflare

1. **Login to Cloudflare**: https://dash.cloudflare.com
2. Click **"Add a Site"**
3. Enter: `pipilot.dev`
4. Select **Free** plan
5. Click **"Continue"**

Cloudflare will scan your DNS records.

### 2. Verify DNS Records

Cloudflare should detect your Vercel records:

```
Type    Name             Content                      Proxy
A       pipilot.dev      76.76.21.21                 Proxied
CNAME   www              cname.vercel-dns.com        Proxied
```

**IMPORTANT:** Keep these! This ensures your site stays on Vercel.

If missing, add them manually:
- Get your Vercel IP from: https://vercel.com/docs/edge-network/overview
- Usually: `76.76.21.21` for A record
- Or CNAME to: `cname.vercel-dns.com`

### 3. Update Nameservers

Cloudflare will provide nameservers like:
```
eva.ns.cloudflare.com
walt.ns.cloudflare.com
```

**Go to your domain registrar:**

#### Namecheap
1. Dashboard → Domain List → pipilot.dev → Manage
2. Nameservers → Custom DNS
3. Paste Cloudflare nameservers
4. Save

#### GoDaddy
1. My Products → Domains → pipilot.dev → DNS
2. Nameservers → Change → Custom
3. Paste Cloudflare nameservers
4. Save

#### Other Registrars
1. Find DNS/Nameserver settings
2. Change to "Custom Nameservers"
3. Paste Cloudflare nameservers

**Propagation:** 5 minutes to 24 hours (usually 15 minutes)

### 4. Add Custom Domain to Worker

Once nameservers are updated:

1. **Cloudflare Dashboard** → **Workers & Pages**
2. Click **"pipilot-search-api"**
3. **Settings** → **"Domains & Routes"**
4. Click **"Add Custom Domain"**
5. Enter: `api.pipilot.dev`
6. Click **"Add Domain"**

Cloudflare will:
- ✅ Create DNS A/AAAA records automatically
- ✅ Issue SSL certificate (Let's Encrypt)
- ✅ Route traffic to your Worker

**Done!** Your API will be at `https://api.pipilot.dev`

### 5. Verify Setup

Wait 5-10 minutes, then test:

```bash
# Health check
curl https://api.pipilot.dev/health

# Expected response:
{
  "status": "ok",
  "version": "1.0.0",
  "timestamp": "..."
}
```

```bash
# Search test
curl -X POST https://api.pipilot.dev/search \
  -H "Authorization: Bearer test-key-123" \
  -H "Content-Type: application/json" \
  -d '{"query":"AI frameworks 2025"}'
```

---

## 🔍 Troubleshooting

### "DNS_PROBE_FINISHED_NXDOMAIN"

**Cause:** Nameservers not updated or not propagated yet

**Solution:**
1. Check nameservers: `nslookup -type=NS pipilot.dev`
2. Should show Cloudflare nameservers
3. Wait 15-30 minutes for propagation
4. Clear DNS cache: `ipconfig /flushdns` (Windows) or `sudo dscacheutil -flushcache` (Mac)

### "ERR_SSL_VERSION_OR_CIPHER_MISMATCH"

**Cause:** SSL certificate not issued yet

**Solution:**
1. Wait 5-10 minutes for Cloudflare to issue cert
2. Check: Cloudflare Dashboard → SSL/TLS → Edge Certificates
3. Should show "Active Certificate" for api.pipilot.dev

### "Worker Not Found" or 404

**Cause:** DNS not pointing to Worker

**Solution:**
1. Cloudflare Dashboard → DNS → Records
2. Verify `api.pipilot.dev` points to Worker (should be automatic)
3. If missing, add manually:
   - Type: AAAA
   - Name: api
   - Content: 100:: (Cloudflare Worker placeholder)
   - Proxy: Enabled

### Main Site (pipilot.dev) Not Working

**Cause:** DNS records not preserved

**Solution:**
1. Cloudflare Dashboard → DNS → Records
2. Add back Vercel records:
   ```
   Type: A
   Name: @
   Content: 76.76.21.21
   Proxy: Enabled
   ```
   ```
   Type: CNAME
   Name: www
   Content: cname.vercel-dns.com
   Proxy: Enabled
   ```
3. In Vercel Dashboard → pipilot.dev → Settings → Domains
4. Verify domain is still connected

---

## ✅ Final Setup

After completion, you'll have:

```
https://pipilot.dev          → Vercel (your main site)
https://www.pipilot.dev      → Vercel (your main site)
https://api.pipilot.dev      → Cloudflare Worker (search API)
```

**DNS:** Cloudflare (free, fast, global)
**Hosting:** Vercel (main site) + Cloudflare Workers (API)
**SSL:** Free on both
**Cost:** $0

---

## 🚀 Benefits of This Setup

1. **Fast DNS** - Cloudflare's global DNS network
2. **Free SSL** - Auto-renewal on both Vercel & Cloudflare
3. **DDoS Protection** - Cloudflare's built-in protection
4. **Easy Management** - All DNS in one place
5. **Best Performance** - Worker on Cloudflare edge
6. **Zero Cost** - Everything on free tiers

---

## 📊 DNS Record Summary

After setup, your DNS should look like:

```
Type    Name             Content                      Proxy   Notes
A       @                76.76.21.21                 ON      Vercel (main site)
CNAME   www              cname.vercel-dns.com        ON      Vercel (www)
AAAA    api              100::                       ON      Worker (auto-created)
```

---

## 🔄 Updating the API

After deploying updates:

```bash
cd /c/Users/DELL/Downloads/ai-app-builder/pipilot-search-api
git add .
git commit -m "Update API"
git push
npx wrangler deploy
```

Changes go live at both URLs:
- `https://pipilot-search-api.hanscadx8.workers.dev`
- `https://api.pipilot.dev`

---

## 📞 Support

**Cloudflare DNS Issues:**
- Community: https://community.cloudflare.com/
- Docs: https://developers.cloudflare.com/dns/

**Vercel Hosting Issues:**
- Support: https://vercel.com/support
- Docs: https://vercel.com/docs

**Worker Issues:**
- Check logs: `npx wrangler tail`
- Cloudflare Dashboard → Workers & Pages → pipilot-search-api → Logs

---

Made with ❤️ by Hans Ade @ Pixelways Solutions Inc
