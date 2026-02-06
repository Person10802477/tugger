// ==UserScript==
// @name         Tugger Ratio FCLM line item
// @namespace    http://tampermonkey.net/
// @version      1.7
// @description  Inserts a Tugger Ratio line in FCLM below STPS using the following formula: (ETI hours + ESTP hours) / (Tugger hours + Trans hours)
// @updateURL    https://gist.githubusercontent.com/Person10802477/8a9f93c7cef9a8b0b532436ea395c0c5/raw/tugger-ratio.user.js?nocache
// @downloadURL  https://gist.githubusercontent.com/Person10802477/8a9f93c7cef9a8b0b532436ea395c0c5/raw/tugger-ratio.user.js?nocache
// @match        *://fclm-portal.amazon.com/*
// @match        *://*fclm*.corp.amazon.com/*
// @grant        GM_xmlhttpRequest
// @connect      fclm-portal.amazon.com
// @connect      fclm*.corp.amazon.com
// ==/UserScript==

(function () {
    'use strict';

    let hasFetched = false;

    // Add hover styling for the tugger ratio row
    const style = document.createElement('style');
    style.textContent = `
        tr.tugger-hover td {
            transition: background-color 0.15s ease-in-out;
        }
        tr.tugger-hover:hover td:not(.kpi-cell) {
            background-color: #D0DAFD;
        }
    `;
    document.head.appendChild(style);

    // Extract hours value from a specific line item in the table
    const extractHours = (lineItem) => {
        for (let row of document.querySelectorAll('tr')) {
            const cells = Array.from(row.querySelectorAll('td, th'), c => c.textContent.trim());
            const idx = cells.indexOf(lineItem);
            if (idx >= 0) {
                // Look for the hours value in the next 3-6 columns
                for (let j = idx + 3; j < Math.min(idx + 6, cells.length); j++) {
                    const val = parseFloat(cells[j].replace(/,/g, ''));
                    if (!isNaN(val) && val > 0 && val < 10000000) return val;
                }
            }
        }
        return null;
    };

    // Fetch combined hours from Cart Handler Stow + Stow to Prime Trans with retry mechanism
    const fetchCombinedHours = (callback, retryCount = 0) => {
        // Find the link to the Function Rollup page
        const link = Array.from(document.querySelectorAll('a')).find(
            a => a.textContent.includes('Stow to Prime Spt') && a.href.includes('functionRollup')
        );
        if (!link) {
            console.log('Link not found, retry count:', retryCount);
            return false;
        }

        console.log('Link found! Fetching data from:', link.href);

        GM_xmlhttpRequest({
            method: 'GET',
            url: link.href,
            timeout: 10000, // 10 second timeout
            onload: (res) => {
                const doc = new DOMParser().parseFromString(res.responseText, 'text/html');
                const rows = doc.querySelectorAll('tr');

                let cartHandlerHours = 0;
                let transHours = 0;
                let inCartHandler = false;
                let inTrans = false;

                // Parse the Function Rollup page to extract hours
                for (let row of rows) {
                    const cells = Array.from(row.querySelectorAll('td, th'));
                    const texts = cells.map(c => c.textContent.trim());

                    // Detect Cart Handler Stow section
                    if (texts.some(t => t.includes('Cart Handler Stow'))) inCartHandler = true;
                    if (inCartHandler && cartHandlerHours === 0) {
                        for (let cell of cells) {
                            if (cell.classList.contains('size-total') && cell.classList.contains('highlighted')) {
                                const val = parseFloat(cell.textContent.replace(/,/g, ''));
                                if (!isNaN(val) && val > 0) {
                                    cartHandlerHours = val;
                                    inCartHandler = false;
                                    break;
                                }
                            }
                        }
                    }

                    // Detect Stow to Prime Trans section
                    if (texts.some(t => t.includes('Stow to Prime Trans'))) inTrans = true;
                    if (inTrans && transHours === 0) {
                        for (let cell of cells) {
                            if (cell.classList.contains('size-total') && cell.classList.contains('highlighted')) {
                                const val = parseFloat(cell.textContent.replace(/,/g, ''));
                                if (!isNaN(val) && val > 0) {
                                    transHours = val;
                                    inTrans = false;
                                    break;
                                }
                            }
                        }
                    }

                    if (cartHandlerHours && transHours) break;
                }

                callback(cartHandlerHours + transHours);
            },
            onerror: (err) => {
                // Retry up to 3 times with increasing delays
                if (retryCount < 3) {
                    console.log(`Request failed (attempt ${retryCount + 1}/3), retrying in ${500 * (retryCount + 1)}ms...`, err);
                    setTimeout(() => fetchCombinedHours(callback, retryCount + 1), 500 * (retryCount + 1));
                } else {
                    console.error('Request failed after 3 attempts:', err);
                    // Update the row to show error state
                    const row = document.getElementById('tugger-expenditure-row');
                    if (row) {
                        const cells = row.querySelectorAll('td');
                        cells[2].textContent = 'Error';
                        cells[3].textContent = 'Error';
                        cells[4].textContent = 'Error';
                    }
                }
            },
            ontimeout: () => {
                // Retry on timeout
                if (retryCount < 3) {
                    console.log(`Request timed out (attempt ${retryCount + 1}/3), retrying...`);
                    setTimeout(() => fetchCombinedHours(callback, retryCount + 1), 500 * (retryCount + 1));
                } else {
                    console.error('Request timed out after 3 attempts');
                    // Update the row to show timeout state
                    const row = document.getElementById('tugger-expenditure-row');
                    if (row) {
                        const cells = row.querySelectorAll('td');
                        cells[2].textContent = 'Timeout';
                        cells[3].textContent = 'Timeout';
                        cells[4].textContent = 'Timeout';
                    }
                }
            }
        });

        return true;
    };

    // Fix alignment for "Stow to Prime - Total" row by adding a blank cell
    const fixStowToPrimeTotalAlignment = () => {
        const stowTotalRow = Array.from(document.querySelectorAll('tr')).find(r =>
            Array.from(r.querySelectorAll('td')).some(c => c.textContent.trim() === 'Stow to Prime - Total')
        );

        if (stowTotalRow && !stowTotalRow.dataset.fixedAlignment) {
            const firstCell = stowTotalRow.querySelector('td');
            const padding = window.getComputedStyle(firstCell).padding;

            const blankCell = document.createElement('td');
            blankCell.style.padding = padding;
            blankCell.style.borderTop = 'none';
            blankCell.style.borderBottom = '1px solid #aabcfe';
            blankCell.style.backgroundColor = '#b9c9fe';

            stowTotalRow.insertBefore(blankCell, stowTotalRow.firstChild);
            stowTotalRow.dataset.fixedAlignment = 'true';
        }
    };

    // Fix alignment for "IB Total" row by adding a blank cell
    const fixIBTotalAlignment = () => {
        const IBTotalRow = Array.from(document.querySelectorAll('tr')).find(r =>
            Array.from(r.querySelectorAll('td')).some(c => c.textContent.trim() === 'IB Total')
        );

        if (IBTotalRow && !IBTotalRow.dataset.fixedAlignment) {
            const firstCell = IBTotalRow.querySelector('td');
            const padding = window.getComputedStyle(firstCell).padding;

            const blankCell = document.createElement('td');
            blankCell.style.padding = padding;
            blankCell.style.borderTop = 'none';
            blankCell.style.borderBottom = '1px solid #aabcfe';
            blankCell.style.backgroundColor = '#b9c9fe';

            IBTotalRow.insertBefore(blankCell, IBTotalRow.firstChild);
            IBTotalRow.dataset.fixedAlignment = 'true';
        }
    };

    // Create the placeholder row with "Fetching..." text
    const createPlaceholderRow = (targetRow) => {
        if (document.getElementById('tugger-expenditure-row')) return;

        const numCols = targetRow.children.length;
        const padding = window.getComputedStyle(targetRow.children[0]).padding;

        const placeholders = [
            'Tugger Ratio',
            'EACH',
            'Fetching…',
            'Fetching…',
            'Fetching…',
            '7:1',
            'Fetching…',
            'Fetching…',
            'Fetching…'
        ];

        const row = document.createElement('tr');
        row.id = 'tugger-expenditure-row';
        row.classList.add('tugger-hover');

        for (let i = 0; i < numCols; i++) {
            const td = document.createElement('td');
            td.style.padding = padding;
            td.style.borderBottom = '1px solid #aabcfe';
            td.style.textAlign = i === 0 ? 'left' : i === 1 ? 'center' : 'right';
            td.textContent = placeholders[i] || '';
            row.appendChild(td);
        }

        targetRow.parentNode.insertBefore(row, targetRow.nextSibling);
    };

    // Trigger the onmouseover event on the Stow to Prime Support link
    const triggerLinkLoad = () => {
        const link = Array.from(document.querySelectorAll('a')).find(
            a => a.textContent.includes('Stow to Prime Support')
        );

        if (link && link.onmouseover) {
            console.log('Triggering onmouseover event on Stow to Prime Support link');
            // Call the onmouseover function directly
            link.onmouseover();
            return true;
        }
        return false;
    };

    // Main loop to set up the Tugger Ratio row and fetch data
    const mainLoop = () => {
        if (hasFetched) return;

        const targetRow = Array.from(document.querySelectorAll('tr')).find(r =>
            Array.from(r.querySelectorAll('td')).some(c => c.textContent.trim() === 'Stow to Prime Support')
        );

        if (!targetRow) {
            requestAnimationFrame(mainLoop);
            return;
        }

        fixStowToPrimeTotalAlignment();
        fixIBTotalAlignment();
        createPlaceholderRow(targetRow);

        const transferIn = extractHours('Each Transfer In - Total');
        const stowPrime = extractHours('Each Stow to Prime - Total');

        if (!transferIn || !stowPrime) {
            requestAnimationFrame(mainLoop);
            return;
        }

        // Trigger the onmouseover event to load the link
        triggerLinkLoad();

        // Wait 500ms for the link to be loaded into the DOM
        setTimeout(() => {
            const started = fetchCombinedHours((totalSupportHours) => {
                const combined = transferIn + stowPrime;
                const rate = combined / totalSupportHours;
                const planRate = 7;
                const percent = (rate / planRate) * 100;
                const plannedHours = combined / planRate;
                const hoursPositiveToPlan = plannedHours - totalSupportHours;

                const row = document.getElementById('tugger-expenditure-row');
                const cells = row.querySelectorAll('td');


                // Three-tier color coding: green (≥100%), yellow (95-99.99%), red (<95%)
                let bg;
                if (percent >= 100) {
                    bg = '#a3cfbb'; // Green
                } else if (percent >= 95) {
                    bg = '#ffe69c'; // Yellow
                } else if (percent <95) {
                    bg = '#f1aeb5'; // Red
                }

                cells[2].textContent = combined.toFixed(2);
                cells[3].textContent = totalSupportHours.toFixed(2);
                cells[4].textContent = rate.toFixed(2);
                cells[6].textContent = plannedHours.toFixed(2);
                cells[7].textContent = hoursPositiveToPlan.toFixed(2);
                cells[8].textContent = percent.toFixed(2) + '%';

                cells[4].style.backgroundColor = bg;
                cells[8].style.backgroundColor = bg;
                cells[4].classList.add('kpi-cell');
                cells[8].classList.add('kpi-cell');

                hasFetched = true;
            });

            if (!started) {
                // If link still not found, try triggering again
                console.log('Link not found after first trigger, retrying...');
                setTimeout(() => {
                    triggerLinkLoad();
                    setTimeout(mainLoop, 500);
                }, 500);
            }
        }, 500);
    };

    requestAnimationFrame(mainLoop);
})();