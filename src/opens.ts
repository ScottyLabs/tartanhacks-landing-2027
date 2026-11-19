/**
 * What is further down the page than the first screen opens outward the
 * first time it is scrolled to, as the first screen did when it arrived.
 *
 * A block that is still out of sight is shut here, and let go when it comes
 * into view; the stylesheet does the opening (`.opens`, `.opens.shut`). What
 * is in view already is left alone: nothing closes in front of a reader.
 */
export function openOnSight(blocks: Iterable<Element>): void {
  if (!('IntersectionObserver' in window)) return;

  const watcher = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.remove('shut');
        watcher.unobserve(entry.target);
      }
    },
    // Once a sixth of it shows, so that it opens where it can be seen to. A
    // share of the block and not a line across the screen: the last block on
    // the page may never get far up the screen.
    { threshold: 0.16 },
  );

  for (const block of blocks) {
    if (block.getBoundingClientRect().top < window.innerHeight) continue;
    block.classList.add('shut');
    watcher.observe(block);
  }
}
