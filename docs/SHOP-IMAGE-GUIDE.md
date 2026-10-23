# Naai Shop — product image guide (for the client / catalogue team)

This is the spec to hand to whoever uploads product photos in the admin panel
(**Naai Shop → Products → Image**). Follow it and every card looks the same on
every phone and laptop, with no black bands around the photo.

---

## 1. The one-line answer

> **Upload a square photo: 1200 × 1200 px, JPG, product on a plain white
> background, product filling about 85% of the frame, file under 250 KB.**

If you remember nothing else, remember **1:1 (square)**. The app shows the photo
whole and never crops it, so a square photo fills the frame exactly.

---

## 2. Exact numbers

| What | Value | Why |
|---|---|---|
| **Aspect ratio** | **1 : 1 (square)** | The card frame is square on phones and only 25:22 on laptops; a square photo fills both with at most a 6% matte. |
| **Ideal size** | **1200 × 1200 px** | The largest a card is ever drawn is ~300 px wide; at 3× (high-DPI phones) that is 900 px. 1200 leaves headroom for zoomed/retina screens without bloating storage. |
| **Minimum** | **800 × 800 px** | Below this the photo looks soft on a 3× phone. |
| **Maximum** | **2000 × 2000 px** | Bigger adds no visible detail, only load time and storage. |
| **Format** | **JPG** (photos) · **PNG** only when the background must be transparent · WebP is also accepted | JPG is the smallest for photos. |
| **Colour profile** | **sRGB** | Anything else (Adobe RGB, CMYK) can shift colours in browsers. |
| **File size** | **≤ 250 KB** (hard ceiling 1 MB) | Three photos per screen on a 4G phone. |
| **Background** | **Plain white `#FFFFFF`** (or transparent PNG) | The shop card is dark; a white backdrop reads as a clean product tile. Cropped-in backgrounds look like a broken image. |
| **Product fill** | about **85%** of the frame, **5–7% empty margin** on all four sides | Prevents the photo looking cramped or the product touching the card's rounded corners. |
| **Number of products** | **one** product per image | No collages, no "buy 2" bundles unless that is literally the pack being sold. |
| **Baked-in text** | **none** | No watermark, no border, no price/MRP, no "% off", no shop logo. The app draws the discount badge, rating and price itself. |

---

## 3. Why square (and what happens with other shapes)

The shop never crops a product photo — a bottle keeps its cap, a box keeps its
lid. That means the card is a fixed window and the photo is fitted **inside**
it:

| Uploaded shape | What the customer sees |
|---|---|
| **1:1 square** (recommended) | Fills the frame edge to edge. **Best.** |
| 4:5 or 5:4 (near-square) | A thin matte on two sides — still looks deliberate. |
| 3:4 portrait (like most old catalogue shots) | Noticeable band left and right. The band is a soft, blurred copy of the same photo (never black), but the product looks smaller. |
| 16:9 or wider | Big band above and below; the product looks small. Avoid. |
| Very tall (e.g. 1:2 bottle screenshot) | Wide bands; avoid — re-shoot on a square canvas. |

A phone screen is the tightest case: two cards side by side, so each photo is
only ~140–160 px wide on screen. Anything with a wide or tall frame loses most
of that space to the matte.

---

## 4. How to get a square photo from a non-square original

Any of these works and takes seconds:

1. **Phone/gallery crop** — crop to 1:1 with the product centred, keep a small
   margin, then export at 1200 × 1200.
2. **Photoshop / Photopea (free)** — `Image → Canvas Size` to a square (equal to
   the longer side), fill the new area with white, then `Image → Image Size` to
   1200 × 1200.
3. **Any batch resizer** (IrfanView, XnConvert, Squoosh) — set "fit into
   1200 × 1200, pad with white, keep aspect ratio". Squoosh (web, free) is the
   easiest for a one-off and also gets the file under 250 KB.

**Do not** stretch a portrait photo into a square — that distorts the bottle.
Pad it with white instead.

---

## 5. Quick self-check before uploading

1. Open the file at **200 px wide**. The product should still be clearly
   recognisable and centred — that is roughly how big it will appear on a phone.
2. The image is **square** (width = height).
3. The background is **pure white** all the way to the edges (no grey vignette,
   no table edge, no shadow running off-frame).
4. There is **no text, logo or border** baked into the picture.
5. File is **under 250 KB** and the name says what it is
   (`ghar-face-wash-1200.jpg`, not `IMG_20241.jpg`).

---

## 6. What the app does with the file

- **Whole photo, no crop.** `object-fit: contain` on the product card, the
  details hero and the thumbnails. Nothing is ever cut off.
- **The matte is the photo itself.** Where a non-square photo does not reach the
  frame edge, the empty area is filled with a blurred, over-scaled copy of the
  same image — so a white-background shot gets a soft white halo, a dark one a
  dark halo, and there is never a hard black band.
- **Square frame on phones** (1:1) and **25:22 on laptops**, where the cards are
  smaller and the frame stays compact. The details page hero is square on a
  phone and 4:3 on a laptop.
- Photos load lazily and the card shows a branded placeholder until they arrive,
  so a slow connection never shows a broken image.

Following the spec in section 2 means the matte is never visible at all — the
photo fills its frame on every screen size.
