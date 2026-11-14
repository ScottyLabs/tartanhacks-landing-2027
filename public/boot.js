// Runs before first paint. Marks the page as scripted so the entrance can be
// staged without a flash of the unscripted layout. main.css reveals everything
// again on its own if the main script never arrives.
document.documentElement.classList.add('js');
