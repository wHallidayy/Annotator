import os

# ระบุ path โฟลเดอร์ input และ output
input_folder = "input"
output_folder = "output"

# ดึงรายการไฟล์ที่ลงท้ายด้วย .jpg หรือ .JPG
input_files = {f for f in os.listdir(input_folder) if f.lower().endswith(".jpg")}
output_files = {f for f in os.listdir(output_folder) if f.lower().endswith(".jpg")}

# หาไฟล์ที่มีใน input แต่ไม่มีใน output
missing_files = input_files - output_files

# แสดงผล
if missing_files:
    print("ไฟล์ JPG ที่หายไปใน output:")
    for file in sorted(missing_files):
        print(file)
else:
    print("ไฟล์ JPG ใน input มีครบใน output แล้ว")
