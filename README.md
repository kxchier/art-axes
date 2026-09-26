# art axes

art axes is an HCI research prototype for exploring art through user-drawn semantic dimensions. Its collection contains 142 varied public-domain works from the Art Institute of Chicago. Artworks shared by multiple axes combine those dimensions into a nonlinear spatial scaffold. :3

## run locally

You need [Node.js](https://nodejs.org/) installed. In the project folder, run:

```bash
npm run dev
```

Then open [http://localhost:8083](http://localhost:8083) in your browser. Stop the server with `Control-C`.

## deploy with netlify

Connect this repository to Netlify. The included `netlify.toml` publishes the finished static site from `dist`, so no build command or API key is needed. Future pushes to the connected Git branch will deploy automatically.
