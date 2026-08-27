# Developer Guide — Internal Project UI

This guide is for developers who need to **add or change sidebar items**, **header links**, or **footer content** in the future. All of these are driven by config files or simple props so you rarely need to touch component internals.

---

## Table of contents

1. [Project structure](#1-project-structure)
2. [Adding sidebar items](#2-adding-sidebar-items)
3. [Changing the header](#3-changing-the-header)
4. [Customizing the footer](#4-customizing-the-footer)
5. [File reference](#5-file-reference)
6. [Backend (Flask) and content](#6-backend-flask-and-content)

---

## 1. Project structure

```
UI_Design/
├── app.py                    # Flask server (serves UI + REST API routes)
├── src/
│   ├── App.jsx               # Main layout: Header, Sidebar, content column (ContentArea + Footer)
│   ├── config/
│   │   ├── sidebarNav.js     # ← Sidebar menu items
│   │   └── footerConfig.js   # ← Footer branding and links (rendered in content column)
│   └── components/
│       ├── Header/           # Top bar (brand + nav links)
│       ├── Sidebar/          # Left nav (uses sidebarNav.js)
│       ├── ContentArea/      # Main area (URL input + Process)
│       └── Footer/           # Footer in content column only (uses footerConfig.js)
├── services/
│   └── url_processor.py     # Python logic for assisted-test endpoints
└── docs/
    └── DEVELOPER_GUIDE.md    # This file
```

- **Config files** (`src/config/`) are the main place to add items.
- **Components** read from config (or props) and render the UI.

---

## 2. Adding sidebar items

Sidebar entries are defined in **one file**: `src/config/sidebarNav.js`.

### Step 1: Edit the config

Open `src/config/sidebarNav.js`. Each item has:

| Field   | Purpose |
|--------|---------|
| `id`   | Unique key (used for active state and routing). Use lowercase, e.g. `'settings'`. |
| `label`| Text shown in the sidebar, e.g. `'Settings'`. |
| `icon` | Icon key. Must exist in the Sidebar component’s `iconMap` (see below). |

**Example: add “Website Scanner” and “Settings”**

```javascript
export const sidebarNavItems = [
  { id: 'home', label: 'Home', icon: 'home' },
  { id: 'scans', label: 'Website Scanner', icon: 'monitor' },
  { id: 'settings', label: 'Settings', icon: 'settings' },
]
```

Save the file. The sidebar will show the new items immediately.

### Step 2: Add an icon (if needed)

Supported icon keys today: **`home`**, **`monitor`**, **`settings`**.

To use a **new icon**:

1. Open `src/components/Sidebar/Sidebar.jsx`.
2. Find the `iconMap` object (near the top).
3. Add a new entry. The key must match the `icon` value in `sidebarNav.js`. The value is a React element (e.g. an SVG).

**Example: add a “docs” icon**

```javascript
const iconMap = {
  home: ( ... ),
  monitor: ( ... ),
  settings: ( ... ),
  docs: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zM6 20V4h7v5h5v11H6z" />
    </svg>
  ),
}
```

Then in `sidebarNav.js`:

```javascript
{ id: 'docs', label: 'Documentation', icon: 'docs' },
```

### Step 3: Use the active item in your app

When the user clicks a sidebar item, `App.jsx` receives its `id` via `onNavigate`. Right now the app only keeps `activeSidebarId` for highlighting. To **show different content per section**, use `activeSidebarId` in `App.jsx` to conditionally render different components or routes (e.g. Home vs Settings vs Scanner).

**Summary:**  
- Add/remove/reorder items in **`src/config/sidebarNav.js`**.  
- Add new icons in **`src/components/Sidebar/Sidebar.jsx`** in `iconMap`.

---

## 3. Changing the header

The header has two parts: **brand (left)** and **nav links (right)**.

### Option A: Pass props from App.jsx (recommended)

In `src/App.jsx`, the header is used like this:

```jsx
<Header />
```

You can pass:

- **`brandName`** — Text next to the logo (e.g. `"Internal Project"`).
- **`navItems`** — Array of `{ label, href }` for the top-right links.

**Example:**

```jsx
<Header
  brandName="My Company Portal"
  navItems={[
    { label: 'Dashboard', href: '/dashboard' },
    { label: 'Reports', href: '/reports' },
    { label: 'Help', href: '/help' },
  ]}
/>
```

### Option B: Edit default values in Header.jsx

To change the defaults without touching `App.jsx`:

1. Open `src/components/Header/Header.jsx`.
2. Find `defaultNavItems` and edit the array (add/remove/change `label` and `href`).
3. Change the default `brandName` in the function signature:  
   `function Header({ brandName = 'Your Brand', navItems = defaultNavItems })`.

**Summary:**  
- Prefer **Option A** so all layout choices stay in `App.jsx`.  
- Use **Option B** only if you want the header to have its own default content.

---

## 4. Customizing the footer

The footer is **in the content area only** (at the bottom of the main content column, to the right of the sidebar). It is driven by **`src/config/footerConfig.js`** and rendered by the `Footer` component inside the content column. No need to edit the Footer component for normal content changes.

### What you can change

| Export in `footerConfig.js` | Purpose |
|----------------------------|--------|
| **`footerBrand`** | Logo block (logo letters, label, tagline) and product name line. |
| **`footerLinks`** | Navigation links (e.g. Privacy Policy, Terms, Contact). |
| **`footerCopyright`** | Copyright text (e.g. `© 2024 United Techno`). |

### Footer brand object

The footer matches the sidebar branding: UT circle + label + tagline, then a product name line.

```javascript
export const footerBrand = {
  logoLetters: 'UT',              // Text inside the circular logo
  label: 'UNITED TECHNO',         // Uppercase text next to logo
  tagline: 'united we solve',     // Small line under label (same as sidebar)
  productName: 'Data Comparison Portal', // Line below the logo block
}
```

Edit these strings to match your branding.

### Footer links

```javascript
export const footerLinks = [
  { label: 'Privacy Policy', href: '/privacy' },
  { label: 'Terms of Service', href: '/terms' },
  { label: 'Contact Support', href: '/contact' },
]
```

Add or remove items; each needs `label` and `href`.

### Copyright

```javascript
export const footerCopyright = '© 2024 United Techno'
```

Update the year or company name as needed.

**Summary:**  
- All footer content is in **`src/config/footerConfig.js`**.  
- Change `footerBrand`, `footerLinks`, and `footerCopyright`; no need to touch `Footer.jsx` unless you change the footer layout.

---

## 5. File reference

| Goal | File(s) to edit |
|------|------------------|
| Add/remove/reorder **sidebar** items | `src/config/sidebarNav.js` |
| Add a new **sidebar icon** | `src/components/Sidebar/Sidebar.jsx` → `iconMap` |
| Change **header** brand or nav links | `src/App.jsx` (props to `<Header />`) or `src/components/Header/Header.jsx` (defaults) |
| Change **footer** (in content area) branding, links, copyright | `src/config/footerConfig.js` |
| Change main **content** (e.g. URL form) | `src/components/ContentArea/ContentArea.jsx` |
| Change **backend** URL processing | `services/url_processor.py` and/or `app.py` |

---

## 6. Backend (Flask) and content

- **Flask** serves the built React app and all REST API routes (`/api/scan`, `/api/history`, `/api/crawl`, etc.).
- The UI sends `{ "url": "..." }` to `POST /api/scan` and polls `GET /api/scan/<jobId>` for results.
- Assisted-test logic lives in **`services/url_processor.py`**.
- To add more API routes or call other Python scripts, edit **`app.py`** and/or **`services/url_processor.py`**.

For building and running the app (npm, Flask), see the main **README.md** in the project root.

---

## Quick checklist for future developers

- **New sidebar item** → `src/config/sidebarNav.js` (+ optional new icon in `Sidebar.jsx`).  
- **New header link or brand** → `App.jsx` (Header props) or `Header.jsx` (defaults).  
- **Footer text or links** → `src/config/footerConfig.js`.  
- **New API or Python logic** → `app.py` and `services/url_processor.py`.

If you need to change the **layout** of the footer (e.g. extra sections), edit `src/components/Footer/Footer.jsx` and `Footer.css`; keep using `footerConfig.js` for the data.
