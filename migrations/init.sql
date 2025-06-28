CREATE TABLE IF NOT EXISTS screenshot_qr (
    id SERIAL PRIMARY KEY,
    path VARCHAR(255) NOT NULL,
    url VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    is_active BOOLEAN DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS messages (
    id SERIAL PRIMARY KEY,
    from_number VARCHAR(255),
    to_number VARCHAR(255),
    body TEXT,
    from_me BOOLEAN,
    timestamp BIGINT,
    chat_name VARCHAR(255),
    contact_name VARCHAR(255)
);