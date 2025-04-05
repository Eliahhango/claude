import pino from 'pino';

// Basic logger setup
const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

export default logger; 