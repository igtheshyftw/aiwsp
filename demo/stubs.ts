// Node-only services that the online demo does not have (malware scanning, email).
export function connect(): never { throw Error('Not available in the online demo.'); }
export default {createTransport() { return {async sendMail() { throw Error('Email is not available in the online demo.'); }}; }};
