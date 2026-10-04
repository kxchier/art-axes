# art axes

art axes is an HCI research prototype for exploring art through user-drawn semantic dimensions. Its collection contains 142 varied public-domain works from the Art Institute of Chicago. A shared spatial board holds draggable, resizable interpretive frames, while artworks shared by multiple axes within a frame combine those dimensions into a nonlinear spatial scaffold. :3

## run locally

You need [Node.js](https://nodejs.org/) installed. In the project folder, run:

```bash
npm run dev
```

Then open [http://localhost:8083](http://localhost:8083) in your browser. Stop the server with `Control-C`.

## arrangement modes

Each frame has its own **axes** or **magnets** mode, so both kinds can appear together on the board. Choose the mode when creating a frame, or use the **axes / magnets** switch to change the selected frame. In axes mode, draw a dimension and name its two ends. In magnets mode, choose **place magnet**, click inside a frame, and name a concept such as “dreamlike” or “geometric”. CLIP scores the selected artworks locally; stronger matches gather closer to the magnet, while multiple magnets combine their pull. Drag a magnet or focus it and use the arrow keys (Shift for larger steps) to rearrange the art.
