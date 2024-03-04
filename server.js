import express from 'express'
import multer from 'multer';
import data from './store.js';
import AWS from 'aws-sdk'
import dotenv from 'dotenv';
import path from 'path';


dotenv.config()

//cau hinh aws
AWS.config.update({
  region: process.env.REGION,
  accessKeyId: process.env.ACCESS_KEY_ID,
  secretAccessKey: process.env.SECRET_ACCESS_KEY,
})

const s3 = new AWS.S3()
const dynamodb = new AWS.DynamoDB.DocumentClient()
const tableName = process.env.DYNAMO_TABLE_NAME


const app = express();
const PORT = 4000;

//register middlewares
app.use(express.json({
  extended: false
}))
app.use(express.static('./views'))
app.use("/", express.static("./node_modules/bootstrap/dist/"));

//config view
app.set('view engine', 'ejs');
app.set('views', './views');

// cau hinh lai multer
const storage = multer.memoryStorage({
  destination(req, file, callback) {
    callback(null, '')
  }
})

const uploadConfig = {
  storage,
  limits: {
    fileSize: 2000000
  }, // chi cho phep toi da 2mb
  fileFilter(req, file, cb) {
    checkFileType(file, cb)
  }
};

const upload = multer(uploadConfig);

function checkFileType(file, cb) {
  const fileTypes = /jpeg|jpg|png|gif/;
  const extname = fileTypes.test(path.extname(file.originalname).toLowerCase())
  const mimetype = fileTypes.test(file.mimetype)
  if (extname && mimetype) {
    return cb(null, true);
  }
  return cb(
    'error: image only pls'
  )
}

//routers
app.get('/', async (req, res) => {
  try {
    const params = {
      TableName: tableName
    };
    const data = await dynamodb.scan(params).promise();
    res.render('index.ejs', {
      data: data.Items
    })
  } catch (error) {
    console.log("error: ", error)
    return res.status(500).send("internal server error")
  }
})

//them 1 data
app.post("/save", upload.single('image'), (req, res) => {
  try {
    const productId = Number(req.body.productId);
    const productName = req.body.productName;
    const quantity = req.body.quantity;

    const image = req.file.originalname.split('.');
    // console.log(image);
    const fileTypes = image[image.length - 1];
    const filePath = `${productId + Date.now().toString()}.${fileTypes}`;

    const paramsS3 = {
      Bucket: process.env.S3_BUCKET_NAME,
      Key: filePath,
      Body: req.file.buffer,
      ContentType: req.file.mimetype,
      ACL: 'public-read' // Thiết lập đối tượng là public
    };

    s3.upload(paramsS3, async (err, data) => {
      if (err) {
        console.log("error: ", err);
        return res.status(500).send("internal server error")
      } else {
        //Sau khi upload -> se gan URL cho image
        const imageUrl = data.Location;
        console.log("imageUrl: ", imageUrl);
        const paramsDynamoDb = {
          TableName: tableName,
          Item: {
            MASP: productId,
            TENSANPHAM: productName,
            SOLUONG: quantity,
            IMAGE: imageUrl
          }
        };
        try {
          await dynamodb.put(paramsDynamoDb).promise();
          return res.redirect('/');
        } catch (error) {
          console.log("error: ", error);
          return res.status(500).send("internal server error")
        }
      }
    })
  } catch (error) {
    console.log("Error saving data from DynamoDB: ", error);
    return res.status(500).send("internal server error");
  }
})

app.post("/delete", upload.fields([]), (req, res) => {
  // Cách 1: Lấy ra list các checkbox được chọn ==> chỉ xoá các item trên DynamoDB
  // const listCheckboxSelected = Object.keys(req.body);
  // console.log("listCheckboxSelected: ", listCheckboxSelected);
  // ---------------------

  // Cách 2: Lấy ra list các checkbox được chọn ==> xoá các item trên DynamoDB và xoá các ảnh trên S3
  const listCheckboxSelected = [];
  const listDelImg = [];
  for (const key in req.body) {
    if (key.startsWith('checkbox_') && key.endsWith('_ckb')) {
      const checkboxValue = req.body[key];
      listCheckboxSelected.push(checkboxValue);
    }
  }
  for (const key in req.body) {
    for (const checkboxValue of listCheckboxSelected) {
      if (key.endsWith(checkboxValue)) {
        const urlImage = req.body[key];
        const parts = urlImage.split("/");
        const keyImage = parts[parts.length - 1];
        listDelImg.push(keyImage);
      }
    }
  }
  console.log("List of selected checkboxes:", listCheckboxSelected);
  console.log("List of selected del:", listDelImg);
  // ---------------------

  if (!listCheckboxSelected || listCheckboxSelected.length <= 0) {
    return res.redirect('/');
  }
  try {
    function onDeleteItem(length) { //Định nghĩa hàm đệ quy
      const params = {
        TableName: tableName,
        Key: {
          MASP: Number(listCheckboxSelected[length])
        }
      };
      dynamodb.delete(params, (err, data) => {
        if (err) {
          console.log("error: ", err);
          return res.status(500).send("internal server error")
        } else {
          if (length > 0) {
            onDeleteItem(length - 1);
          } else {
            return res.redirect('/');
          }
        }
      })

      //Xoá ảnh trên S3
      s3.deleteObject({
        Bucket: process.env.S3_BUCKET_NAME,
        Key: listDelImg[length]
      }, (err, data) => {
        if (err) {
          console.log("error: ", err);
          return res.status(500).send("internal server error")
        }
      })
      // ----------------
    }
    onDeleteItem(listCheckboxSelected.length - 1);
  } catch (error) {
    console.log("error deleting data from DynamoDB: ", error);
    return res.status(500).send("internal server error")
  }
})

app.post('/', upload.none([]), (req, res) => {
  debugger;
  console.log(req.body);
  data.push(req.body);
  res.redirect('/');
  res.send('ok');
})

app.listen(PORT, function () {
  console.log('Example app listening on port 4000!');
});