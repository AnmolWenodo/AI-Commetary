import winston from "winston";

const { combine, timestamp, printf, colorize, errors } = winston.format;

const logFormat = printf((info) => {
    const { timestamp, level, message, stack, ...meta } = info;

    let output = `${timestamp} [${level}] ${stack || message}`;

    if (Object.keys(meta).length) {
        output += ` ${JSON.stringify(meta, null, 2)}`;
    }

    return output;
});

const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || "info",

    format: combine(
        errors({ stack: true }),
        timestamp({ format: "YYYY-MM-DD HH:mm:ss" })
    ),

    transports: [
        new winston.transports.File({
            filename: "logs/error.log",
            level: "error",
            format: combine(logFormat),
        }),

        new winston.transports.File({
            filename: "logs/app.log",
            format: combine(logFormat),
        }),
    ],
});

if (process.env.NODE_ENV !== "production") {
    logger.add(
        new winston.transports.Console({
            format: combine(
                colorize(),
                timestamp({ format: "HH:mm:ss" }),
                logFormat
            ),
        })
    );
}

export default logger;