const RETRYABLE_COUNTRY_CODES = new Set([
    'rate_limited',
    'request_rejected',
    'graphql_http_error',
    'profile_not_found',
]);

export function proxyCountryCandidates(primaryCountry, fallbackCountries = [], maxCountries = 4) {
    const countries = [primaryCountry, ...(Array.isArray(fallbackCountries) ? fallbackCountries : [])]
        .map((value) => String(value || '').trim().toUpperCase())
        .filter((value) => /^[A-Z]{2}$/.test(value));
    return [...new Set(countries)].slice(0, Math.max(1, Number(maxCountries) || 1));
}

export function shouldRetryProfileInAnotherCountry(error) {
    return Boolean(error?.retryable) && RETRYABLE_COUNTRY_CODES.has(String(error?.code || ''));
}
