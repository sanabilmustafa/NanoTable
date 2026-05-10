from flask import Flask, request, jsonify, render_template
import psycopg2
from psycopg2.extras import RealDictCursor
from werkzeug.security import generate_password_hash, check_password_hash

app = Flask(__name__)

# Database connection helper
def get_db_connection():
    return psycopg2.connect(
        dbname="dbproject", user="dbproject", 
        password="dbproject", host="localhost"
    )

# --- AUTH ENDPOINTS ---

@app.route('/auth/register', methods=['POST'])
def register():
    data = request.json
    hashed_pw = generate_password_hash(data['password'])
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute(
        "INSERT INTO users (name, email, password) VALUES (%s, %s, %s) RETURNING user_id",
        (data['name'], data['email'], hashed_pw)
    )
    user_id = cur.fetchone()[0]
    conn.commit()
    cur.close()
    conn.close()
    return jsonify({"user_id": user_id, "message": "User created"}), 201

@app.route('/auth/login', methods=['POST'])
def login():
    data = request.json
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    cur.execute("SELECT * FROM users WHERE email = %s", (data['email'],))
    user = cur.fetchone()
    cur.close()
    conn.close()
    
    if user and check_password_hash(user['password'], data['password']):
        return jsonify({"message": "Login successful", "user_id": user['user_id']})
    return jsonify({"message": "Invalid credentials"}), 401

# --- TABLE ENDPOINTS ---

@app.route('/tables', methods=['POST', 'GET'])
def manage_tables():
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    
    if request.method == 'POST':
        data = request.json
        cur.execute("INSERT INTO tables (user_id, table_name) VALUES (%s, %s) RETURNING table_id",
                    (data['user_id'], data['table_name']))
        table_id = cur.fetchone()['table_id']
        conn.commit()
        return jsonify({"table_id": table_id}), 201
    
    user_id = request.args.get('user_id')
    cur.execute("SELECT * FROM tables WHERE user_id = %s", (user_id,))
    tables = cur.fetchall()
    return jsonify(tables)

@app.route('/tables/<int:table_id>', methods=['PUT', 'DELETE'])
def table_detail(table_id):
    conn = get_db_connection()
    cur = conn.cursor()
    if request.method == 'DELETE':
        cur.execute("DELETE FROM tables WHERE table_id = %s", (table_id,))
    else:
        cur.execute("UPDATE tables SET table_name = %s WHERE table_id = %s", 
                    (request.json['table_name'], table_id))
    conn.commit()
    return jsonify({"status": "success"})

# --- COLUMN ENDPOINTS ---

@app.route('/columns', methods=['POST'])
def add_column():
    data = request.json
    table_id = data['table_id']
    column_name = data['column_name']
    data_type = data['data_type']
    
    conn = get_db_connection()
    cur = conn.cursor()
    
    try:
        # We use a subquery to find the current max order and add 1.
        # COALESCE handles the case where the table has 0 columns.
        query = """
            INSERT INTO columns (table_id, column_name, data_type, column_order)
            VALUES (
                %s, %s, %s, 
                (SELECT COALESCE(MAX(column_order), 0) + 1 FROM columns WHERE table_id = %s)
            )
            RETURNING column_id;
        """
        cur.execute(query, (table_id, column_name, data_type, table_id))
        column_id = cur.fetchone()[0]
        conn.commit()
        return jsonify({"column_id": column_id, "status": "column added"}), 201
    
    except Exception as e:
        conn.rollback()
        return jsonify({"error": str(e)}), 400
    finally:
        cur.close()
        conn.close()

@app.route('/tables/<int:table_id>/columns', methods=['GET'])
def get_columns(table_id):
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    cur.execute("SELECT * FROM columns WHERE table_id = %s ORDER BY column_order", (table_id,))
    return jsonify(cur.fetchall())


@app.route('/columns/reorder', methods=['PUT'])
def reorder_columns():
    # Expects a list of {column_id: 1, order: 2}
    data = request.json 
    conn = get_db_connection()
    cur = conn.cursor()
    
    for item in data['new_order']:
        cur.execute(
            "UPDATE columns SET column_order = %s WHERE column_id = %s",
            (item['order'], item['column_id'])
        )
    
    conn.commit()
    return jsonify({"status": "order updated"})

# --- DELETE COLUMN ---
@app.route('/columns/<int:column_id>', methods=['DELETE'])
def delete_column(column_id):
    conn = get_db_connection()
    cur = conn.cursor()
    
    # Because of ON DELETE CASCADE in your schema, 
    # deleting the column will automatically remove all entries 
    # in 'cellvalues' that reference this column_id.
    cur.execute("DELETE FROM columns WHERE column_id = %s", (column_id,))
    
    conn.commit()
    cur.close()
    conn.close()
    return jsonify({"message": f"Column {column_id} and all its data deleted"}), 200


# --- DELETE ROW ---
@app.route('/rows/<int:row_id>', methods=['DELETE'])
def delete_row(row_id):
    conn = get_db_connection()
    cur = conn.cursor()
    
    # Similarly, ON DELETE CASCADE handles the cleanup of 
    # all 'cellvalues' associated with this row_id.
    cur.execute("DELETE FROM rows WHERE row_id = %s", (row_id,))
    
    conn.commit()
    cur.close()
    conn.close()
    return jsonify({"message": f"Row {row_id} deleted"}), 200

# --- CELL LOGIC ---

def get_column_mapping(data_type):
    mapping = {
        'TEXT': 'value_text',
        'NUMBER': 'value_number',
        'DATE': 'value_date',
        'BOOLEAN': 'value_boolean'
    }
    return mapping.get(data_type)

@app.route('/cells', methods=['POST'])
def upsert_cell():
    data = request.json
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    
    # 1. Get the data type of the column
    cur.execute("SELECT data_type FROM columns WHERE column_id = %s", (data['column_id'],))
    col_type = cur.fetchone()['data_type']
    db_col = get_column_mapping(col_type)
    
    # 2. Upsert using ON CONFLICT
    query = f"""
        INSERT INTO cellvalues (row_id, column_id, {db_col})
        VALUES (%s, %s, %s)
        ON CONFLICT (row_id, column_id) DO UPDATE SET {db_col} = EXCLUDED.{db_col}
    """
    cur.execute(query, (data['row_id'], data['column_id'], data['value']))
    conn.commit()
    return jsonify({"status": "updated"})

# --- FULL DATA & FILTERING ---

@app.route('/tables/<int:table_id>/data', methods=['GET'])
def get_table_data(table_id):
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)

    # Fetch columns
    cur.execute("SELECT column_id, column_name, data_type FROM columns WHERE table_id = %s", (table_id,))
    cols = cur.fetchall()

    # Read filter params
    filter_col = request.args.get('column')
    filter_val = request.args.get('value')
    filter_op  = request.args.get('op', '=')

    op_map = {'=':'=', '!=':'!=', '>':'>', '<':'<', '>=':'>=', '<=':'<=', 'contains':'ILIKE'}
    sql_op = op_map.get(filter_op, '=')

    # Map column data_type to the correct cellvalues field
    db_col_map = {
        'TEXT':    'cv.value_text',
        'NUMBER':  'cv.value_number',
        'DATE':    'cv.value_date',
        'BOOLEAN': 'cv.value_boolean',
    }

    if filter_col and filter_val:
        # Look up the data type for the filtered column
        col_type = next((c['data_type'] for c in cols if c['column_name'] == filter_col), 'TEXT')
        db_filter_col = db_col_map.get(col_type, 'cv.value_text')
        typed_val = f'%{filter_val}%' if sql_op == 'ILIKE' else filter_val
        filter_clause = f"""
            AND r.row_id IN (
                SELECT cv.row_id FROM cellvalues cv
                JOIN columns c ON cv.column_id = c.column_id
                WHERE c.column_name = %s AND c.table_id = %s
                AND {db_filter_col} {sql_op} %s
            )
        """
        params = (table_id, filter_col, table_id, typed_val)
    else:
        filter_clause = ''
        params = (table_id,)

    query = f"""
        SELECT
            r.row_id,
            c.column_name,
            cv.value_text,
            cv.value_number,
            cv.value_date,
            cv.value_boolean
        FROM rows r
        LEFT JOIN cellvalues cv ON r.row_id = cv.row_id
        LEFT JOIN columns c ON cv.column_id = c.column_id
        WHERE r.table_id = %s {filter_clause}
    """
    cur.execute(query, params)
    raw_results = cur.fetchall()

    # Python logic to pick the correct non-null value (same as Sanabil's original)
    formatted_rows = {}
    for entry in raw_results:
        rid = entry['row_id']
        if rid not in formatted_rows:
            formatted_rows[rid] = {"row_id": rid, "values": {}}
        if entry['column_name']:
            val = next((entry[k] for k in ['value_text', 'value_number', 'value_date', 'value_boolean']
                       if entry[k] is not None), None)
            formatted_rows[rid]['values'][entry['column_name']] = val

    cur.close()
    conn.close()
    return jsonify({"columns": cols, "rows": list(formatted_rows.values())})

# --- INSERT FULL ROW ---

@app.route('/rows/full', methods=['POST'])
def insert_full_row():
    try:
        data = request.json
        table_id = data['table_id']
        values = data['values'] # e.g. {"Habit Name": "Gym"}
        
        conn = get_db_connection()
        cur = conn.cursor(cursor_factory=RealDictCursor)
        
        # 1. Create the row
        cur.execute("INSERT INTO rows (table_id) VALUES (%s) RETURNING row_id", (table_id,))
        row_id = cur.fetchone()['row_id']
        
        # 2. Get columns for this table to map names to IDs and Types
        cur.execute("SELECT column_id, column_name, data_type FROM columns WHERE table_id = %s", (table_id,))
        col_map = {c['column_name']: (c['column_id'], c['data_type']) for c in cur.fetchall()}
        
        # 3. Insert cell values
        for col_name, val in values.items():
            if col_name in col_map:
                cid, ctype = col_map[col_name]
                db_col = get_column_mapping(ctype)
                cur.execute(f"INSERT INTO cellvalues (row_id, column_id, {db_col}) VALUES (%s, %s, %s)",
                            (row_id, cid, val))
        
        conn.commit()
    except:
        conn.rollback()
        return jsonify({"error": "Failed to insert row"}), 400
    return jsonify({"row_id": row_id}), 201


@app.route('/')
def home():
    return render_template('index.html')

@app.route('/table.html')
def table_page():
    return render_template('table.html')

@app.route('/login.html')
def login_page():
    return render_template('login.html')

if __name__ == '__main__':
    app.run(debug=True)