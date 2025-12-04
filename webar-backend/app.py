from typing import List, Optional

from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from sqlalchemy import create_engine, Column, Integer, String, Text
from sqlalchemy.orm import declarative_base, sessionmaker, Session

# ==========================
# 1. 資料庫連線設定
# ==========================

# 格式: mysql+pymysql://<user>:<password>@<host>:<port>/<database>
DATABASE_URL = "mysql+pymysql://root@localhost:3306/webar_db"

engine = create_engine(DATABASE_URL, echo=False, future=True)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()


def get_db() -> Session:
    """FastAPI 依賴注入用的 Session 產生器。"""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# ==========================
# 2. SQLAlchemy ORM 模型
# ==========================

class UserORM(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    name = Column(String(100), nullable=False)
    nickname = Column(String(100), nullable=True)
    description = Column(Text, nullable=True)
    avatar_url = Column(String(255), nullable=True)
    extra_info = Column(Text, nullable=True)


# ==========================
# 3. Pydantic 模型（對外 API 用）
# ==========================

class User(BaseModel):
    id: int
    name: str
    nickname: Optional[str] = None
    description: Optional[str] = None
    avatar_url: Optional[str] = None
    extra_info: Optional[str] = None

    class Config:
        orm_mode = True  # 讓 Pydantic 可以吃 ORM 物件


class UserCreate(BaseModel):
    name: str
    nickname: Optional[str] = None
    description: Optional[str] = None
    avatar_url: Optional[str] = None
    extra_info: Optional[str] = None


# ==========================
# 4. FastAPI 主程式
# ==========================

app = FastAPI(
    title="Web AR Backend (MySQL)",
    description="提供 Web AR 寶箱查詢使用者資料的 API（MySQL 版）",
    version="0.2.0",
)

# CORS 設定：開發先全開，之後可限制來源網域
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],     # TODO: 上線時改成你的前端網址
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# 在啟動時自動建立資料表（如果不存在）
@app.on_event("startup")
def on_startup():
    Base.metadata.create_all(bind=engine)


# ==========================
# 5. 路由
# ==========================

@app.get("/health")
def health_check():
    """給前端測試後端有沒有活著。"""
    return {"status": "ok"}


@app.get("/users", response_model=List[User])
def list_users(db: Session = Depends(get_db)):
    """列出所有使用者。"""
    users = db.query(UserORM).all()
    return users


@app.get("/users/{user_id}", response_model=User)
def get_user(user_id: int, db: Session = Depends(get_db)):
    """根據 user_id 取得使用者資料。"""
    user = db.query(UserORM).filter(UserORM.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user


@app.post("/users", response_model=User)
def create_user(data: UserCreate, db: Session = Depends(get_db)):
    """新增使用者。可用來從管理後台添加資料。"""
    user = UserORM(
        name=data.name,
        nickname=data.nickname,
        description=data.description,
        avatar_url=data.avatar_url,
        extra_info=data.extra_info,
    )
    db.add(user)
    db.commit()
    db.refresh(user)  # 取得自動產生的 id
    return user
