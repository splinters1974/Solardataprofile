import pandas as pd

# In-memory session store: session_id → normalised HH DataFrame (N_days × 48)
SESSION_STORE: dict[str, pd.DataFrame] = {}
