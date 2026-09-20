// Small date helpers shared across routes. Bills store dates as either
// "YYYY-MM-DD" or "MM-DD-YYYY" depending on where they came from, so these
// normalize between the two instead of every route re-implementing it.

function parseDate(dateStr) {
    if (!dateStr) return null;
    const parts = dateStr.split('-');
    if (parts[0].length === 2) {
        return new Date(`${parts[2]}-${parts[0]}-${parts[1]}`);
    }
    return new Date(dateStr);
}

function formatDate(dateStr) {
    if (!dateStr) return '';
    const parts = dateStr.split('-');
    if (parts[0].length === 4) {
        return `${parts[1]}-${parts[2]}-${parts[0]}`;
    }
    return dateStr;
}

module.exports = { parseDate, formatDate };
