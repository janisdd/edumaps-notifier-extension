/// <reference path="../node_modules/chrome-types/index.d.ts"/>

type BoxData = {
    boxId: string
    changed: Date
}

/**
 * return the date in hh:ss - dd.MM.yy format
 */
function formatData(date: Date): string {
    let hours = date.getHours().toString().padStart(2, '0')
    let minutes = date.getMinutes().toString().padStart(2, '0')
    let day = date.getDate().toString().padStart(2, '0')
    let month = (date.getMonth() + 1).toString().padStart(2, '0') // Monate sind 0-indexiert
    let year = date.getFullYear().toString().slice(-2) // Nur die letzten zwei Ziffern des Jahres

    return `${hours}:${minutes} - ${day}.${month}.${year}`
}


function createBoxChangedEntry(boxData: BoxData) {

    let boxTemplate = `
    <div class="box-item" id="${boxData.boxId}">
        <div class="content">
            Box mit Id ${boxData} wurde geändert
        </div>

        <div class="time">
            ${formatData(boxData.changed)}
        </div>
    </div>
`
}

function addClickListener(boxData: BoxData) {
    let el = document.getElementById(boxData.boxId)
    if (el) {
        el.addEventListener('click', () => {
            console.log(`Box with id ${boxData.boxId} clicked`)

            chrome.tabs.query({active: true, currentWindow: true}, function(tabs){

                const message: BoxChangedListClickedMessage = {
                    action: 'showBox',
                    boxId: boxData.boxId,
                }

                chrome.tabs.sendMessage(tabs[0].id, message); 
            })
        })
    }
}

chrome.runtime.onMessage.addListener((message: SiteNewBoxMessage, sender, sendResponse) => {
    console.log(message)

    if (message.type === 'BOX_CREATED') {
        let boxData: BoxData = {
            boxId: message.boxId,
            changed: new Date(message.createdAt)
        }

        let entry = createBoxChangedEntry(boxData)

        let container = document.getElementById('changed-boxes-list')
        if (container) {
            container.innerHTML = entry + container.innerHTML
            addClickListener(boxData)
        }
    }

})

