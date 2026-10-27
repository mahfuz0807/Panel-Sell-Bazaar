
const express = require("express");
const cors = require("cors");
const path = require("path");

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/api/test", (req, res) => {
  res.json({
    ok: true,
    message: "Backend connected successfully"
  });
});

// One-time, restricted admin email update
app.post("/api/admin/update-email", async (req, res) => {
  const token = req.get("x-update-token");
  const expectedToken = process.env.EMAIL_UPDATE_TOKEN;
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!expectedToken || !supabaseUrl || !serviceKey) {
    return res.status(500).json({
      ok: false,
      message: "Required environment variables are missing"
    });
  }

  if (!token || token !== expectedToken) {
    return res.status(401).json({
      ok: false,
      message: "Unauthorized"
    });
  }

  try {
    const uid = "aaf8d698-3d4f-4cb2-bc57-a94bdf4bcff1";
    const oldEmail = "mahfuzhasan0807@gmail.com";
    const newEmail = "panelsellbazzr0807@gmail.com";

    const check = await fetch(
      `${supabaseUrl}/auth/v1/admin/users/${uid}`,
      {
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`
        }
      }
    );

    if (!check.ok) {
      return res.status(502).json({
        ok: false,
        message: "Could not verify the existing Supabase user"
      });
    }

    const user = await check.json();

    if (user.email === newEmail) {
      return res.json({
        ok: true,
        message: "The email is already updated"
      });
    }

    if (user.email !== oldEmail) {
      return res.status(409).json({
        ok: false,
        message: "Current email does not match the expected old email"
      });
    }

    const update = await fetch(
      `${supabaseUrl}/auth/v1/admin/users/${uid}`,
      {
        method: "PUT",
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          email: newEmail,
          email_confirm: true
        })
      }
    );

    const result = await update.json();

    if (!update.ok) {
      return res.status(502).json({
        ok: false,
        message: result.msg || result.message || "Supabase email update failed"
      });
    }

    return res.json({
      ok: true,
      message: "Admin email updated. Verify it in Supabase Auth."
    });
  } catch (error) {
    console.error("Admin email update failed:", error.message);
    return res.status(500).json({
      ok: false,
      message: "Server error while updating email"
    });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});
        
