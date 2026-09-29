# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

## Deployment: `vercel.json`

This app uses `react-router-dom`'s `BrowserRouter`, so routes like `/publish` or
`/archive` only exist as far as client-side JavaScript is concerned — there is no
`publish.html` file for a static host to serve. Without `vercel.json`, requesting
`/publish` directly (a page refresh, or a bookmarked/shared link) returns a 404,
because Vercel is being asked for a file that doesn't exist. The `rewrites` rule in
`vercel.json` tells Vercel to serve `index.html` for any request that doesn't match
a real static asset (the JS/CSS bundle, images, etc. are still served directly,
untouched); the app's JavaScript then loads and React Router takes it from there.
This is Vercel's own documented pattern for single-page apps.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.
