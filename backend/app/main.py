import datetime
import sqlite3
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from .database import db, init_db

app = FastAPI(title="Haushalts-Dashboard")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def startup():
    init_db()


def row(r: sqlite3.Row) -> dict:
    return dict(r)


def rows(rs) -> list:
    return [dict(r) for r in rs]


def week_start_of(d: datetime.date) -> datetime.date:
    return d - datetime.timedelta(days=d.weekday())


def parse_week(week: Optional[str]) -> str:
    if week:
        try:
            d = datetime.date.fromisoformat(week)
        except ValueError:
            raise HTTPException(400, "Ungültiges Datum, erwartet YYYY-MM-DD")
    else:
        d = datetime.date.today()
    return week_start_of(d).isoformat()


# ---------- Members ----------

class MemberIn(BaseModel):
    name: str
    color: str = "#6366f1"


@app.get("/api/members")
def list_members():
    with db() as conn:
        return rows(conn.execute("SELECT * FROM members ORDER BY name").fetchall())


@app.post("/api/members")
def create_member(m: MemberIn):
    with db() as conn:
        try:
            cur = conn.execute(
                "INSERT INTO members (name, color) VALUES (?, ?)", (m.name.strip(), m.color)
            )
        except sqlite3.IntegrityError:
            raise HTTPException(400, "Mitglied existiert bereits")
        return row(conn.execute("SELECT * FROM members WHERE id=?", (cur.lastrowid,)).fetchone())


@app.delete("/api/members/{member_id}")
def delete_member(member_id: int):
    with db() as conn:
        conn.execute("DELETE FROM members WHERE id=?", (member_id,))
    return {"ok": True}


# ---------- Rooms ----------

class RoomIn(BaseModel):
    name: str


@app.get("/api/rooms")
def list_rooms():
    with db() as conn:
        return rows(conn.execute("SELECT * FROM rooms ORDER BY name").fetchall())


@app.post("/api/rooms")
def create_room(r: RoomIn):
    with db() as conn:
        try:
            cur = conn.execute("INSERT INTO rooms (name) VALUES (?)", (r.name.strip(),))
        except sqlite3.IntegrityError:
            raise HTTPException(400, "Raum existiert bereits")
        return row(conn.execute("SELECT * FROM rooms WHERE id=?", (cur.lastrowid,)).fetchone())


@app.delete("/api/rooms/{room_id}")
def delete_room(room_id: int):
    with db() as conn:
        conn.execute("DELETE FROM rooms WHERE id=?", (room_id,))
    return {"ok": True}


# ---------- Tasks (Putzplan) ----------

class TaskIn(BaseModel):
    weekday: int
    room_id: Optional[int] = None
    activity: str
    member_id: Optional[int] = None
    notes: Optional[str] = None


TASK_SELECT = """
SELECT t.*, r.name AS room_name, m.name AS member_name, m.color AS member_color
FROM tasks t
LEFT JOIN rooms r ON r.id = t.room_id
LEFT JOIN members m ON m.id = t.member_id
"""


@app.get("/api/tasks")
def list_tasks(week: Optional[str] = None):
    ws = parse_week(week)
    with db() as conn:
        tasks = rows(conn.execute(TASK_SELECT + " ORDER BY t.weekday, t.id").fetchall())
        completions = {
            c["task_id"]: bool(c["done"])
            for c in conn.execute(
                "SELECT task_id, done FROM task_completions WHERE week_start=?", (ws,)
            ).fetchall()
        }
    for t in tasks:
        t["done"] = completions.get(t["id"], False)
    return {"week_start": ws, "tasks": tasks}


@app.post("/api/tasks")
def create_task(t: TaskIn):
    with db() as conn:
        cur = conn.execute(
            "INSERT INTO tasks (weekday, room_id, activity, member_id, notes) VALUES (?,?,?,?,?)",
            (t.weekday, t.room_id, t.activity.strip(), t.member_id, t.notes),
        )
        return row(conn.execute(TASK_SELECT + " WHERE t.id=?", (cur.lastrowid,)).fetchone())


@app.put("/api/tasks/{task_id}")
def update_task(task_id: int, t: TaskIn):
    with db() as conn:
        cur = conn.execute(
            "UPDATE tasks SET weekday=?, room_id=?, activity=?, member_id=?, notes=? WHERE id=?",
            (t.weekday, t.room_id, t.activity.strip(), t.member_id, t.notes, task_id),
        )
        if cur.rowcount == 0:
            raise HTTPException(404, "Aufgabe nicht gefunden")
        return row(conn.execute(TASK_SELECT + " WHERE t.id=?", (task_id,)).fetchone())


@app.delete("/api/tasks/{task_id}")
def delete_task(task_id: int):
    with db() as conn:
        conn.execute("DELETE FROM tasks WHERE id=?", (task_id,))
    return {"ok": True}


@app.post("/api/tasks/{task_id}/toggle")
def toggle_task(task_id: int, week: Optional[str] = None):
    ws = parse_week(week)
    with db() as conn:
        existing = conn.execute(
            "SELECT * FROM task_completions WHERE task_id=? AND week_start=?", (task_id, ws)
        ).fetchone()
        if existing:
            new_done = 0 if existing["done"] else 1
            conn.execute(
                "UPDATE task_completions SET done=? WHERE id=?", (new_done, existing["id"])
            )
        else:
            new_done = 1
            conn.execute(
                "INSERT INTO task_completions (task_id, week_start, done) VALUES (?,?,1)",
                (task_id, ws),
            )
    return {"task_id": task_id, "week_start": ws, "done": bool(new_done)}


# ---------- Dishes (Favoriten) ----------

class IngredientIn(BaseModel):
    name: str
    quantity: Optional[str] = None
    unit: Optional[str] = None


class DishIn(BaseModel):
    name: str
    notes: Optional[str] = None
    tags: Optional[str] = None
    ingredients: list[IngredientIn] = []


def get_dish(conn, dish_id: int) -> dict:
    d = conn.execute("SELECT * FROM dishes WHERE id=?", (dish_id,)).fetchone()
    if not d:
        raise HTTPException(404, "Gericht nicht gefunden")
    d = row(d)
    d["ingredients"] = rows(
        conn.execute(
            "SELECT * FROM dish_ingredients WHERE dish_id=? ORDER BY id", (dish_id,)
        ).fetchall()
    )
    return d


@app.get("/api/dishes")
def list_dishes():
    with db() as conn:
        ids = [r["id"] for r in conn.execute("SELECT id FROM dishes ORDER BY name").fetchall()]
        return [get_dish(conn, i) for i in ids]


@app.get("/api/dishes/{dish_id}")
def get_dish_endpoint(dish_id: int):
    with db() as conn:
        return get_dish(conn, dish_id)


@app.post("/api/dishes")
def create_dish(d: DishIn):
    with db() as conn:
        try:
            cur = conn.execute(
                "INSERT INTO dishes (name, notes, tags) VALUES (?,?,?)",
                (d.name.strip(), d.notes, d.tags),
            )
        except sqlite3.IntegrityError:
            raise HTTPException(400, "Gericht existiert bereits")
        dish_id = cur.lastrowid
        for ing in d.ingredients:
            conn.execute(
                "INSERT INTO dish_ingredients (dish_id, name, quantity, unit) VALUES (?,?,?,?)",
                (dish_id, ing.name.strip(), ing.quantity, ing.unit),
            )
        return get_dish(conn, dish_id)


@app.put("/api/dishes/{dish_id}")
def update_dish(dish_id: int, d: DishIn):
    with db() as conn:
        cur = conn.execute(
            "UPDATE dishes SET name=?, notes=?, tags=? WHERE id=?",
            (d.name.strip(), d.notes, d.tags, dish_id),
        )
        if cur.rowcount == 0:
            raise HTTPException(404, "Gericht nicht gefunden")
        conn.execute("DELETE FROM dish_ingredients WHERE dish_id=?", (dish_id,))
        for ing in d.ingredients:
            conn.execute(
                "INSERT INTO dish_ingredients (dish_id, name, quantity, unit) VALUES (?,?,?,?)",
                (dish_id, ing.name.strip(), ing.quantity, ing.unit),
            )
        return get_dish(conn, dish_id)


@app.delete("/api/dishes/{dish_id}")
def delete_dish(dish_id: int):
    with db() as conn:
        conn.execute("DELETE FROM dishes WHERE id=?", (dish_id,))
    return {"ok": True}


# ---------- Meal plan (Essensplan) ----------

class MealPlanIn(BaseModel):
    weekday: int
    dish_id: Optional[int] = None
    custom_text: Optional[str] = None
    wishes: Optional[str] = None
    member_id: Optional[int] = None


MEAL_SELECT = """
SELECT mp.*, d.name AS dish_name, m.name AS member_name
FROM meal_plan mp
LEFT JOIN dishes d ON d.id = mp.dish_id
LEFT JOIN members m ON m.id = mp.member_id
"""


@app.get("/api/mealplan")
def get_mealplan(week: Optional[str] = None):
    ws = parse_week(week)
    with db() as conn:
        entries = rows(
            conn.execute(MEAL_SELECT + " WHERE mp.week_start=? ORDER BY mp.weekday", (ws,)).fetchall()
        )
    return {"week_start": ws, "entries": entries}


@app.post("/api/mealplan")
def upsert_mealplan(entry: MealPlanIn, week: Optional[str] = None):
    ws = parse_week(week)
    with db() as conn:
        existing = conn.execute(
            "SELECT id FROM meal_plan WHERE week_start=? AND weekday=?", (ws, entry.weekday)
        ).fetchone()
        if existing:
            conn.execute(
                "UPDATE meal_plan SET dish_id=?, custom_text=?, wishes=?, member_id=? WHERE id=?",
                (entry.dish_id, entry.custom_text, entry.wishes, entry.member_id, existing["id"]),
            )
            mp_id = existing["id"]
        else:
            cur = conn.execute(
                "INSERT INTO meal_plan (week_start, weekday, dish_id, custom_text, wishes, member_id) VALUES (?,?,?,?,?,?)",
                (ws, entry.weekday, entry.dish_id, entry.custom_text, entry.wishes, entry.member_id),
            )
            mp_id = cur.lastrowid
        return row(conn.execute(MEAL_SELECT + " WHERE mp.id=?", (mp_id,)).fetchone())


@app.delete("/api/mealplan/{entry_id}")
def delete_mealplan(entry_id: int):
    with db() as conn:
        conn.execute("DELETE FROM meal_plan WHERE id=?", (entry_id,))
    return {"ok": True}


# ---------- Shopping list (Einkaufsliste) ----------

class ShoppingItemIn(BaseModel):
    name: str
    quantity: Optional[str] = None
    unit: Optional[str] = None
    category: Optional[str] = None


class ShoppingItemUpdate(BaseModel):
    name: Optional[str] = None
    quantity: Optional[str] = None
    unit: Optional[str] = None
    category: Optional[str] = None
    checked: Optional[bool] = None


@app.get("/api/shopping")
def list_shopping():
    with db() as conn:
        return rows(
            conn.execute(
                "SELECT * FROM shopping_items ORDER BY checked, category IS NULL, category, name"
            ).fetchall()
        )


@app.post("/api/shopping")
def add_shopping_item(item: ShoppingItemIn):
    with db() as conn:
        cur = conn.execute(
            "INSERT INTO shopping_items (name, quantity, unit, category) VALUES (?,?,?,?)",
            (item.name.strip(), item.quantity, item.unit, item.category),
        )
        return row(conn.execute("SELECT * FROM shopping_items WHERE id=?", (cur.lastrowid,)).fetchone())


@app.put("/api/shopping/{item_id}")
def update_shopping_item(item_id: int, item: ShoppingItemUpdate):
    with db() as conn:
        current = conn.execute("SELECT * FROM shopping_items WHERE id=?", (item_id,)).fetchone()
        if not current:
            raise HTTPException(404, "Artikel nicht gefunden")
        data = dict(current)
        for field in ("name", "quantity", "unit", "category"):
            val = getattr(item, field)
            if val is not None:
                data[field] = val
        if item.checked is not None:
            data["checked"] = 1 if item.checked else 0
        conn.execute(
            "UPDATE shopping_items SET name=?, quantity=?, unit=?, category=?, checked=? WHERE id=?",
            (data["name"], data["quantity"], data["unit"], data["category"], data["checked"], item_id),
        )
        return row(conn.execute("SELECT * FROM shopping_items WHERE id=?", (item_id,)).fetchone())


@app.delete("/api/shopping/{item_id}")
def delete_shopping_item(item_id: int):
    with db() as conn:
        conn.execute("DELETE FROM shopping_items WHERE id=?", (item_id,))
    return {"ok": True}


@app.delete("/api/shopping")
def clear_shopping(only_checked: bool = False):
    with db() as conn:
        if only_checked:
            conn.execute("DELETE FROM shopping_items WHERE checked=1")
        else:
            conn.execute("DELETE FROM shopping_items")
    return {"ok": True}


@app.post("/api/shopping/generate")
def generate_from_mealplan(week: Optional[str] = None):
    ws = parse_week(week)
    with db() as conn:
        dish_ids = [
            r["dish_id"]
            for r in conn.execute(
                "SELECT DISTINCT dish_id FROM meal_plan WHERE week_start=? AND dish_id IS NOT NULL",
                (ws,),
            ).fetchall()
        ]
        added = 0
        for dish_id in dish_ids:
            ingredients = conn.execute(
                "SELECT name, quantity, unit FROM dish_ingredients WHERE dish_id=?", (dish_id,)
            ).fetchall()
            for ing in ingredients:
                existing = conn.execute(
                    "SELECT id FROM shopping_items WHERE lower(name)=lower(?) AND checked=0",
                    (ing["name"],),
                ).fetchone()
                if existing:
                    continue
                conn.execute(
                    "INSERT INTO shopping_items (name, quantity, unit, category) VALUES (?,?,?,?)",
                    (ing["name"], ing["quantity"], ing["unit"], "Essensplan"),
                )
                added += 1
    return {"week_start": ws, "added": added}


# ---------- Frontend ----------

STATIC_DIR = Path(__file__).resolve().parent.parent / "static"
app.mount("/", StaticFiles(directory=str(STATIC_DIR), html=True), name="static")
