//we need this because of content policy
document.addEventListener("callEduAnchorScroll", (e) => {

    // create a tmp anchor el like this:
    // <a class="inline selfopener" href="#fotosammlung">xyz</a>

    console.log("callEduAnchorScroll event received", e)
    
    try {
      window.anchor_scroll_done = false;
      window.edu_anchor_scroll_to_box(e.detail.boxWrapId, -1, false, null);
    } catch (err) {
      console.error("Error:", err);
    }
  });