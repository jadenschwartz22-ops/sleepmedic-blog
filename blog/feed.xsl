<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet version="1.0"
  xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
  xmlns:atom="http://www.w3.org/2005/Atom">
  <xsl:output method="html" encoding="UTF-8" indent="yes"
    doctype-public="-//W3C//DTD XHTML 1.0 Transitional//EN"
    doctype-system="http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd"/>
  <xsl:template match="/">
    <html lang="en">
      <head>
        <meta charset="utf-8"/>
        <meta name="viewport" content="width=device-width,initial-scale=1"/>
        <title><xsl:value-of select="/rss/channel/title"/> &#8212; RSS feed</title>
        <meta name="robots" content="noindex,follow"/>
        <link rel="icon" type="image/png" sizes="32x32" href="/blog/favicon-32.png"/>
        <link rel="preconnect" href="https://fonts.googleapis.com"/>
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="crossorigin"/>
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&amp;display=swap" rel="stylesheet"/>
        <style>
          :root{--bg:#0a0a0c;--surface:#141416;--border:rgba(255,255,255,.08);--text:#f5f5f5;--text-2:#b0b0b8;--text-3:#6b6b76;--accent:#a78bfa;--accent-2:#60a5fa}
          *{margin:0;padding:0;box-sizing:border-box}
          body{font-family:'Inter',-apple-system,sans-serif;background:var(--bg);color:var(--text-2);line-height:1.65;-webkit-font-smoothing:antialiased;min-height:100vh}
          .wrap{max-width:720px;margin:0 auto;padding:48px 24px 96px}
          .brand{font-size:.95rem;font-weight:700;color:var(--text);letter-spacing:-.02em;text-decoration:none;display:inline-block;margin-bottom:40px}
          .brand:hover{color:var(--accent)}
          .kicker{font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--accent);margin-bottom:12px}
          h1{font-size:clamp(1.8rem,4vw,2.4rem);font-weight:800;color:var(--text);letter-spacing:-.03em;margin-bottom:14px;line-height:1.2}
          .lede{font-size:1rem;color:var(--text-3);margin-bottom:28px;max-width:560px}
          .callout{background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:20px 22px;margin-bottom:40px;font-size:.9rem;color:var(--text-2)}
          .callout strong{color:var(--text);font-weight:600}
          .callout code{background:rgba(255,255,255,.06);border:1px solid var(--border);border-radius:6px;padding:2px 8px;font-size:.82rem;color:var(--text);font-family:ui-monospace,Menlo,monospace;word-break:break-all}
          .callout a{color:var(--accent);text-decoration:underline;text-decoration-color:rgba(167,139,250,.35);text-underline-offset:3px}
          .callout a:hover{color:var(--accent-2)}
          .label{font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--text-3);margin-bottom:14px}
          ul{list-style:none}
          li.item{border-top:1px solid var(--border);padding:22px 0}
          li.item:last-child{border-bottom:1px solid var(--border)}
          li.item a.title{display:block;font-size:1.1rem;font-weight:600;color:var(--text);text-decoration:none;letter-spacing:-.01em;margin-bottom:6px;line-height:1.35}
          li.item a.title:hover{color:var(--accent)}
          li.item .meta{font-size:.78rem;color:var(--text-3);margin-bottom:10px}
          li.item .meta .cat{color:var(--accent);font-weight:600;text-transform:uppercase;letter-spacing:.05em;margin-right:10px}
          li.item p.desc{font-size:.92rem;color:var(--text-2);line-height:1.55}
          footer{margin-top:64px;padding-top:24px;border-top:1px solid var(--border);font-size:.78rem;color:var(--text-3)}
          footer a{color:var(--text-3);text-decoration:none}
          footer a:hover{color:var(--text)}
        </style>
      </head>
      <body>
        <div class="wrap">
          <a class="brand" href="/">SleepMedic</a>
          <p class="kicker">RSS feed</p>
          <h1><xsl:value-of select="/rss/channel/title"/></h1>
          <p class="lede"><xsl:value-of select="/rss/channel/description"/></p>
          <div class="callout">
            <p><strong>This is the machine-readable feed URL.</strong> Paste it into a reader like Feedly, Reeder, NetNewsWire, or Inoreader:</p>
            <p style="margin-top:10px"><code><xsl:value-of select="/rss/channel/atom:link/@href"/></code></p>
            <p style="margin-top:14px">Prefer the regular site? <a href="/blog/">Read posts on sleepmedic.co &#8594;</a></p>
          </div>
          <p class="label">Latest posts</p>
          <ul>
            <xsl:for-each select="/rss/channel/item">
              <li class="item">
                <a class="title">
                  <xsl:attribute name="href"><xsl:value-of select="link"/></xsl:attribute>
                  <xsl:value-of select="title"/>
                </a>
                <p class="meta">
                  <span class="cat"><xsl:value-of select="category"/></span>
                  <xsl:value-of select="substring(pubDate, 1, 16)"/>
                </p>
                <p class="desc"><xsl:value-of select="description"/></p>
              </li>
            </xsl:for-each>
          </ul>
          <footer>
            <p><a href="/">Home</a> &#183; <a href="/blog/">Blog</a> &#183; <a href="/about/">About</a></p>
          </footer>
        </div>
      </body>
    </html>
  </xsl:template>
</xsl:stylesheet>
