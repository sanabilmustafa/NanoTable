POST /auth/register
{
  "name": "Sanabil",
  "email": "sanabil@email.com",
  "password": "123456"
}

POST /auth/login

-----------------------
TABLE:
-----------------------
create table:
POST /tables
{
  "user_id": 1,
  "table_name": "Habit Tracker"
}

get all tables:
GET /tables?user_id=1

delete table:
DELETE /tables/{table_id}

rename table:
PUT /tables/{table_id}

-----------------------
COLUMNS:
-----------------------

add column:
POST /columns
{
  "table_id": 1,
  "column_name": "Habit Name",
  "data_type": "TEXT"
}

get columns of table:
GET /tables/{table_id}/columns

delete columns:
DELETE /columns/{column_id}

update column (rename, type)
PUT /columns/{column_id}

/columns/reorder
reordering columns for drag and drop functionality


-----------------------
ROWS:
-----------------------
POST /rows
{
  "table_id": 1
}

delete row:
DELETE /rows/{row_id}


-----------------------
CELL VALUE:
-----------------------
insert/update cell value:
POST /cells
{
  "row_id": 1,
  "column_id": 2,
  "value": "Gym"
}
-- Backend decides which column (value_text, value_number, etc.)


-----------------------
get full table data:
-----------------------
GET /tables/{table_id}/data
{
  "columns": [
    {"id": 1, "name": "Habit Name"},
    {"id": 2, "name": "Completed"}
  ],
  "rows": [
    {
      "row_id": 1,
      "values": {
        "Habit Name": "Gym",
        "Completed": true
      }
    }
  ]
}


-----------------------
Filtering:
-----------------------
example for filtering data
GET /tables/{table_id}/data?column=Completed&value=true

-----------------------------
inserting full row at once:
-----------------------------
Insert Full Row (All values at once)
POST /rows/full
{
  "table_id": 1,
  "values": {
    "Habit Name": "Gym",
    "Completed": true,
    "Date": "2026-04-29"
  }
}