CREATE DATABASE dbproject;
create user dbproject with password 'dbproject';
grant all privileges on database dbproject to dbproject;

\c dbproject
grant all on schema public to dbproject;
alter default privileges in schema public grant all on tables to dbproject;
alter database dbproject owner to dbproject;


-- python connection: postgresql://mini_notion_user:password@localhost:5432/mini_notion_db

-- from terminal connect like this: 
-- psql -U dbproject -d dbproject -p 5432;
-- creations:


CREATE TABLE users (
    user_id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL
);

CREATE TABLE tables (
    table_id SERIAL PRIMARY KEY,
    user_id INT NOT NULL,
    table_name VARCHAR(100) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE TYPE data_type_enum AS ENUM ('TEXT', 'NUMBER', 'DATE', 'BOOLEAN');
CREATE TABLE columns (
    column_id SERIAL PRIMARY KEY,
    table_id INT NOT NULL,
    column_name VARCHAR(100) NOT NULL,
    data_type data_type_enum NOT NULL,
    column_order INT,

    FOREIGN KEY (table_id) REFERENCES tables(table_id) ON DELETE CASCADE
);

CREATE TABLE rows (
    row_id SERIAL PRIMARY KEY,
    table_id INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (table_id) REFERENCES tables(table_id) ON DELETE CASCADE
);

CREATE TABLE cellvalues (
    cell_id SERIAL PRIMARY KEY,
    row_id INT NOT NULL,
    column_id INT NOT NULL,

    value_text TEXT,
    value_number DOUBLE PRECISION,
    value_date DATE,
    value_boolean BOOLEAN,

    FOREIGN KEY (row_id) REFERENCES rows(row_id) ON DELETE CASCADE,
    FOREIGN KEY (column_id) REFERENCES columns(column_id) ON DELETE CASCADE,

    UNIQUE (row_id, column_id)
);

CREATE INDEX idx_tables_user_id ON tables(user_id);
CREATE INDEX idx_columns_table_id ON columns(table_id);
CREATE INDEX idx_rows_table_id ON rows(table_id);
CREATE INDEX idx_cellvalues_row_id ON cellvalues(row_id);
CREATE INDEX idx_cellvalues_column_id ON cellvalues(column_id);

ALTER TABLE cellvalues ADD CONSTRAINT only_one_value CHECK (
    (value_text IS NOT NULL)::int +
    (value_number IS NOT NULL)::int +
    (value_date IS NOT NULL)::int +
    (value_boolean IS NOT NULL)::int = 1
);

