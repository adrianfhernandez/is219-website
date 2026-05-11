export function buildProfessorSearchUrl(query, school) {
    const params = new URLSearchParams({ name: query, max: '20' });
    if (school && school.trim()) {
        params.set('school', school.trim());
    }
    return `http://localhost:3001/api/search-professors?${params.toString()}`;
}

export function filterProfessorsBySchool(professors, school) {
    if (!school || !school.trim()) {
        return professors;
    }

    const lowerSchool = school.trim().toLowerCase();
    return professors.filter((prof) => prof.school && prof.school.toLowerCase().includes(lowerSchool));
}

export function isValidGoogleScholarHit(item) {
    return (
        item &&
        item.source === 'Google Scholar' &&
        typeof item.title === 'string' && item.title.trim().length > 0 &&
        typeof item.url === 'string' && item.url.trim().startsWith('http')
    );
}

if (typeof window !== 'undefined') {
    window.rmpUiHelpers = {
        buildProfessorSearchUrl,
        filterProfessorsBySchool,
        isValidGoogleScholarHit
    };
}
