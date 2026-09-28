# doarkal

| קובץ | תיאור |
|------|-------|
| `masechta.html` | אפליקציית **מסכתא** (הגירסה העדכנית) |
| `homepage_sketch.html` | סקיצת דף בית |

## עדכון גירסה של מסכתא

שם הקובץ נשאר תמיד `masechta.html` — כל גירסה חדשה פשוט מחליפה את הקודמת,
וההיסטוריה של כל הגירסאות נשמרת אוטומטית ב-Git (לשונית **History** / **Commits**).

**דרך האתר של GitHub:**
1. שנה את שם הקובץ החדש במחשב ל-`masechta.html`.
2. בדף הריפו: **Add file ← Upload files**, וגרור את הקובץ.
3. בתיבת ההודעה כתוב למשל `Phase 33` ולחץ **Commit changes**.

**דרך שורת הפקודה:**
```bash
cp /path/to/new-version.html masechta.html
git add masechta.html
git commit -m "Phase 33"
git push
```

לחזרה לגירסה קודמת: פתח את `masechta.html` ב-GitHub ← **History** ← בחר גירסה ← **View file** / **Raw**.
