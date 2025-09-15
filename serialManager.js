export class serialManager {
    constructor(modal) {
        this.encoder = new TextEncoder();
        this.decoder = new TextDecoder();
        this.consoleDiv = document.getElementById("console");
        this.port;
        this.shouldListen = true;

        this.modal = modal;

        this.receiveBuffer = [];
        this.inspectBuffer = [];

        this.sentCommandBuffer = [""];
        this.sentCommandBufferIndex = 0;

        this.okRespTimeout = false;
        this.timeoutID = undefined;

        this.bootCommands = [
            "G90",
            "M260 A112 B1 S1",
            "M260 A109",
            "M260 B48",
            "M260 B27",
            "M260 S1",
            "M260 A112 B2 S1",
            "M260 A109",
            "M260 B48",
            "M260 B27",
            "M260 S1",
            "G0 F35000"
        ];

    }


    async appendToConsole(message, direction){
        let newConsoleEntry = document.createElement('p')
        let timestamp = new Date().toISOString();
        let dir = "";

        if(direction){
        dir = "[SEND]"
        }
        else{
        dir = "[RECE]"
        }
        
        newConsoleEntry.innerHTML = dir + " - " + timestamp + " - " + message + '\n';
        this.consoleDiv.appendChild(newConsoleEntry)
        
        this.consoleDiv.scrollTop = this.consoleDiv.scrollHeight;
    }

    clearBuffer(){
        while(this.receiveBuffer.length > 0){
            this.receiveBuffer.shift();
        }
    }

    clearInspectBuffer(){
        while(this.inspectBuffer.length > 0){
            this.inspectBuffer.shift();
        }
    }

    dec2bin(dec) {
        return (dec >>> 0).toString(2);
    }

    delay = (delayInms) => {
        return new Promise(resolve => setTimeout(resolve, delayInms));
    };
    
   

    async connect() {
        if (!navigator.serial){
            this.modal.show("Browser Support", "Please use a browser that supports WebSerial, like Chrome, Opera, or Edge. <a href='https://developer.mozilla.org/en-US/docs/Web/API/Web_Serial_API#browser_compatibility'>Supported Browsers.");
            return false
        }

        const usbVendorId = [{usbVendorId: 0x0483},{usbVendorId: 0x2c99},{usbVendorId: 0x2341}];// 0x2341 is arduino, 0x0483 is stm32 , 0x2c99 is Lumen
        this.port = await navigator.serial.requestPort({ filters:  usbVendorId  })  
        console.log("Port Selected.")

        await this.port.open({
        baudRate: 115200,
        bufferSize: 255,
        dataBits: 8,
        flowControl: "none",
        parity: "none",
        stopBits: 1
        })

        console.log("Port Opened.")
        // const { clearToSend, dataCarrierDetect, dataSetReady, ringIndicator} = await this.port.getSignals()
        // console.log({ clearToSend, dataCarrierDetect, dataSetReady, ringIndicator})
        await this.delay(5000); //wait for marlin to process boot commands
        this.listen()
        
        while(true)
        {   console.log(this.inspectBuffer.length);
            console.log(this.inspectBuffer.toString());
            if(this.inspectBuffer.length == 0){
                break;
            }
            this.clearInspectBuffer();
            await this.delay(1000);
        }

        console.log("Port Readable.")

        document.querySelector("#connect").style.background = 'green';
        document.querySelector("#connect").style.color = 'white';
        document.querySelector("#connect").innerHTML = 'Connected'; 

     
        // Wait for the serial device to stop transmitting
        
        //await this.delay(150000); //wait for marlin to process boot commands
        //send boot commands
        //await this.send(this.bootCommands)
        //await this.send(["M150 P255 R255 U255 B255"]);
        await this.send(["M302 S05"]);  /// M302 - Allow cold extrude, or set minimum extrude temperature <a href="https://reprap.org/wiki/G-code#M302:_Allow_cold_extrudes">M302: Allow cold extrudes</a>
            //This tells the printer to allow movement of the extruder motor above a certain temperature, or if disabled, to allow extruder movement when the hotend is below a safe printing temperature.

        await this.send(["G28 X Y Z"]); //home all axes
        await this.send(["G0 Z31.5"]); //move z to safe height
    

        return true
    }

    // this needs to listen to marlin constantly
    // it comes in randomly, so we have to filter by newlines an add
    // to buffer based on the newlines
    async listen() {
        while (this.port?.readable && this.shouldListen) {
            console.log("Port is readable: Starting to listen.")
            let metabuffer = ""
            let consoleDiv = document.getElementById("console");
            const reader = this.port.readable.getReader()
            try {
                while (this.shouldListen) {
                    const { value, done } = await reader.read()
                    if (done) {
                        console.log("Closing reader.");
                        break;
                    }
                    
                    const decoded = this.decoder.decode(value)
                    metabuffer = metabuffer.concat(decoded);

                    while(metabuffer.indexOf("\n") != -1){
                        let splitted = metabuffer.split('\n');

                        this.receiveBuffer.push(splitted[0]);
                        this.appendToConsole(splitted[0], false);

                        this.inspectBuffer.push(splitted[0]);

                        metabuffer = metabuffer.split('\n').slice(1).join('\n');

                        
                    }
                }
            } catch (error) {
                console.error('Reading error.', error)
            } finally {
                reader.releaseLock()
            }
        }
    }

    sleep(milliseconds) {
        var start = new Date().getTime();
        for (var i = 0; i < 1e7; i++) {
            if ((new Date().getTime() - start) > milliseconds){
            break;
            }
        }
    }

async setOkRespTimeout() {
  return new Promise(resolve => {
    this.timeoutID = setTimeout(() => {
      console.log("timeout triggered");
      this.okRespTimeout = true;
      resolve();
    }, 50000);
  });
}
    async send(commandArray) {
        console.log("sending: ", commandArray);

        if (this.port?.writable) {
        const writer = this.port.writable.getWriter();
        try {
            for (const element of commandArray) {
                await writer.write(this.encoder.encode(element + "\n"))

                this.setOkRespTimeout();

                this.appendToConsole(element, true);

                // check that we got an ok back
                this.clearBuffer()

                while(true){
                    if(this.okRespTimeout) break;

                    let firstElement = this.receiveBuffer.shift();
                    if (firstElement != undefined) console.log(firstElement);
                    if(firstElement == 'ok'){
                        clearTimeout(this.timeoutID);
                        break;
                    }

                    if(firstElement = "echo:busy: processing"){
                        //do something to extend timeout
                        clearTimeout(this.timeoutID)
                        this.setOkRespTimeout();
                    }

                    await new Promise(resolve => setTimeout(resolve, 50)); // Small delay to avoid busy-waiting

                }

                this.okRespTimeout = false;


                // while(true){
                //     console.log(this.okRespTimeout);
                //     let resp = this.receiveBuffer;
                //     for(const element of resp){
                //         console.log(element)
                //     }
                //     console.log("printing response:");
                //     console.log(resp);
                //     console.log(resp[0])

                //     if(this.okRespTimeout == true){
                //         console.log("we're breaking because of timeout");
                //         break;
                //     }

                // }

                

            }
        } finally {
            writer.releaseLock()
        }
        }
        else{
            this.modal.show("Cannot Write", "Cannot write to port. Have you connected?");
        }
    }

    async sendRepl() {
        let command = [document.querySelector("#repl-input").value];

        //adding current command to buffer for uparrow access later, at position 1 to preserve a "" option
        this.sentCommandBuffer.splice(1, 0, command[0])

        //making sure we reset the index back to 0
        this.sentCommandBufferIndex = 0;
        
        this.send(command);

    }


    // TODO most of everything beneath here should move to lumen, not serial

    async leftAirOn(){
        const commandArray = [
        "M106",
        "M106 P1 S255"
        ]
        await this.send(commandArray);
    }

    async leftAirOff(){
        const commandArray = [
        "M107",
        "M107 P1"
        ]
        await this.send(commandArray);
    }

    async rightAirOn(){
        const commandArray = [
        "M106 P2 S255",
        "M106 P3 S255"
        ]
        await this.send(commandArray);
    }

    async rightAirOff(){
        const commandArray = [
        "M107 P2",
        "M107 P3"
        ]
        await this.send(commandArray);
    }

    async ledOn(){
        const commandArray = [
        "M150 P255 R255 U255 B255"
        ]

        await this.send(commandArray);
    }

    async ledOff(){
        const commandArray = [
        "M150 P0"
        ]
        await this.send(commandArray);
    }

    async disableSteppers(){
        const commandArray = [
            "M18"
            ]
            await this.send(commandArray);
    }

    async readLeftVac(){

        if(!this.port?.writable){
        this.modal.show("Cannot Write", "Cannot write to port. Have you connected?");
        return false
        }

        const commandArrayLeft = [
        "M260 A112 B1 S1"
        ]

        const delayVal = 50;

        this.clearInspectBuffer();

        let msb, csb, lsb;
        const regex = new RegExp('data:(..)');

        //send command array
        await this.send(commandArrayLeft);

        this.clearInspectBuffer();

        await this.send(["M260 A109 B6 S1"]);
        await this.send(["M261 A109 B1 S1"]);

        await this.delay(delayVal);

        for (var i=0, x=this.inspectBuffer.length; i<x; i++) {
            let currLine = this.inspectBuffer[i];
            console.log(this.inspectBuffer)
            let result = regex.test(currLine);
            if(result){
                msb = currLine.match("data:(..)")[1];
                break
            }
        }

        this.clearInspectBuffer();
        
        await this.send(["M260 A109 B7 S1"]);
        await this.send(["M261 A109 B1 S1"]);

        await this.delay(delayVal);

        for (var i=0, x=this.inspectBuffer.length; i<x; i++) {
            let currLine = this.inspectBuffer[i];
            let result = regex.test(currLine);
            if(result){
                csb = currLine.match("data:(..)")[1];
                break
            }
        }

        this.clearInspectBuffer();
        
        await this.send(["M260 A109 B8 S1"]);
        await this.send(["M261 A109 B1 S1"]);

        await this.delay(delayVal);

        for (var i=0, x=this.inspectBuffer.length; i<x; i++) {
            let currLine = this.inspectBuffer[i];
            let result = regex.test(currLine);
            if(result){
                lsb = currLine.match("data:(..)")[1];
                break
            }
        }

        // convert hex string to int
        //msb = parseInt(msb, 16);

        // get biggest bit to determine sign
        //let readingSign = (msb & (1 << 7)) === 0 ? 1 : -1;

        // clear biggest bit for actual value calc
        //msb &= 0x7F;

        console.log(msb, csb, lsb)

        let result = parseInt(msb+csb+lsb, 16);

        if(result & (1 << 23)){
            result = result - 2**24
        }

        

        let resp = await this.modal.show("Left Vacuum Sensor Value", result);

        this.clearInspectBuffer();      

    }

    async readRightVac(){

        if(!this.port?.writable){
            this.modal.show("Cannot Write", "Cannot write to port. Have you connected?");
        return false
        }

        const commandArrayRight = [
        "M260 A112 B2 S1",
        ]

        let msb, csb, lsb;
        const regex = new RegExp('data:(..)');

        const delayVal = 50;

        this.clearInspectBuffer();

        //send command array
        await this.send(commandArrayRight);
        await this.delay(delayVal);

        this.clearInspectBuffer();

        await this.send(["M260 A109 B6 S1"]);
        await this.send(["M261 A109 B1 S1"]);
        await this.delay(delayVal);

        for (var i=0, x=this.inspectBuffer.length; i<x; i++) {
            let currLine = this.inspectBuffer[i];
            let result = regex.test(currLine);
            if(result){
                msb = currLine.match("data:(..)")[1];
                break
            }
        }

        this.clearInspectBuffer();
        
        await this.send(["M260 A109 B7 S1"]);
        await this.send(["M261 A109 B1 S1"]);
        await this.delay(delayVal);

        for (var i=0, x=this.inspectBuffer.length; i<x; i++) {
            let currLine = this.inspectBuffer[i];
            let result = regex.test(currLine);
            if(result){
                csb = currLine.match("data:(..)")[1];
                break
            }
        }

        this.clearInspectBuffer();
        
        await this.send(["M260 A109 B8 S1"]);
        await this.send(["M261 A109 B1 S1"]);
        await this.delay(delayVal);

        for (var i=0, x=this.inspectBuffer.length; i<x; i++) {
            let currLine = this.inspectBuffer[i];
            let result = regex.test(currLine);
            if(result){
                lsb = currLine.match("data:(..)")[1];
                break
            }
        }

        // // convert hex string to int
        // msb = parseInt(msb, 16);

        // // get biggest bit to determine sign
        // let readingSign = (msb & (1 << 7)) === 0 ? 1 : -1;

        // // clear biggest bit for actual value calc
        // msb &= 0x7F;

        // let rightVal = parseInt(msb.toString(16)+csb+lsb, 16) * readingSign;

        let result = parseInt(msb+csb+lsb, 16);

        if(result & (1 << 23)){
            result = result - 2**24
        }

        await this.modal.show("Right Vacuum Sensor Value", result);

        this.clearInspectBuffer();

    }

    // tests

    async testTMC(){

        if(!this.port?.writable){
            this.modal.show("Cannot Write", "Cannot write to port. Have you connected?");
        return false
        }

        let testDataBuffer = "";

        const commandArray = [
            "M122"
        ]

        //clean out receive buffer
        await this.clearBuffer();
        
        //send command array
        await this.send(commandArray);

        await this.delay(5000);

        //check receieve buffer
        console.log(this.receiveBuffer);

        //adding to test buffer
        for(let i = 0; i<this.receiveBuffer.length; i++){
            testDataBuffer = testDataBuffer.concat(this.receiveBuffer[i] + "\n");
        }

        let resp = await this.modal.show("Stepper Driver Test Complete", "Test is complete. Click OK to download test report.");

        if(resp == true){
            let filename = new Date().toISOString();
            filename = filename + "-tmctest.txt"

            this.download(filename, testDataBuffer);
        }


    }

    async testVac(){

        if(!this.port?.writable){
            this.modal.show("Cannot Write", "Cannot write to port. Have you connected?");
        return false
        }

        let testDataBuffer = "";

        const commandArrayLeft = [
        "M260 A112 B1 S1",
        "M260 A109",
        "M260 B48",
        "M260 B10",
        "M260 S1"
        ]

        const commandArrayRight = [
        "M260 A112 B2 S1",
        "M260 A109",
        "M260 B48",
        "M260 B10",
        "M260 S1"
        ]

        const delayVal = 100;

        this.clearBuffer();

        let msb, csb, lsb;
        const regex = new RegExp('data:(..)');

        //send command array
        await this.send(commandArrayLeft);

        await this.send(["M260 A109 B6 S1"]);
        await this.send(["M261 A109 B1 S1"]);
        await this.delay(delayVal);

        for (var i=0, x=this.receiveBuffer.length; i<x; i++) {
        let currLine = this.receiveBuffer[i];
        let result = regex.test(currLine);
        if(result){
            msb = currLine.match("data:(..)")[1];
            testDataBuffer = testDataBuffer.concat("Left MSB - " + msb + "\n");
            break
        }
        }

        this.clearBuffer();
        
        await this.send(["M260 A109 B7 S1"]);
        await this.send(["M261 A109 B1 S1"]);
        await this.delay(delayVal);

        for (var i=0, x=this.receiveBuffer.length; i<x; i++) {
        let currLine = this.receiveBuffer[i];
        let result = regex.test(currLine);
        if(result){
            csb = currLine.match("data:(..)")[1];
            testDataBuffer = testDataBuffer.concat("Left CSB - " + csb + "\n");
            break
        }
        }

        this.clearBuffer();
        
        await this.send(["M260 A109 B8 S1"]);
        await this.send(["M261 A109 B1 S1"]);
        await this.delay(delayVal);

        for (var i=0, x=this.receiveBuffer.length; i<x; i++) {
        let currLine = this.receiveBuffer[i];
        let result = regex.test(currLine);
        if(result){
            lsb = currLine.match("data:(..)")[1];
            testDataBuffer = testDataBuffer.concat("Left LSB - " + lsb + "\n");
            break
        }
        }

        let leftVal = parseInt(msb+csb+lsb, 16);

        if(leftVal & (1 << 23)){
            leftVal = leftVal - 2**24
        }

        testDataBuffer = testDataBuffer.concat("Left Val - " + leftVal + "\n");

        // NOW RIGHT SENSOR

        this.clearBuffer();

        //send command array
        await this.send(commandArrayRight);

        await this.send(["M260 A109 B6 S1"]);
        await this.send(["M261 A109 B1 S1"]);
        await this.delay(delayVal);

        for (var i=0, x=this.receiveBuffer.length; i<x; i++) {
        let currLine = this.receiveBuffer[i];
        let result = regex.test(currLine);
        if(result){
            msb = currLine.match("data:(..)")[1];
            testDataBuffer = testDataBuffer.concat("Right MSB - " + msb + "\n");
            break
        }
        }

        this.clearBuffer();
        
        await this.send(["M260 A109 B7 S1"]);
        await this.send(["M261 A109 B1 S1"]);
        await this.delay(delayVal);

        for (var i=0, x=this.receiveBuffer.length; i<x; i++) {
        let currLine = this.receiveBuffer[i];
        let result = regex.test(currLine);
        if(result){
            csb = currLine.match("data:(..)")[1];
            testDataBuffer = testDataBuffer.concat("Right CSB - " + csb + "\n");
            break
        }
        }

        this.clearBuffer();
        
        await this.send(["M260 A109 B8 S1"]);// send I2C command
        await this.send(["M261 A109 B1 S1"]);// request I2C command
        await this.delay(delayVal);

        console.log("current buffer length: ", this.receiveBuffer.length)
        for (var i=0, x=this.receiveBuffer.length; i<x; i++) {
        let currLine = this.receiveBuffer[i];
        let result = regex.test(currLine);
        if(result){
            lsb = currLine.match("data:(..)")[1];
            testDataBuffer = testDataBuffer.concat("Right LSB - " + lsb + "\n");
            break
        }
        }

        let rightVal = parseInt(msb+csb+lsb, 16);

        if(rightVal & (1 << 23)){
            rightVal = rightVal - 2**24
        }

        testDataBuffer = testDataBuffer.concat("Right Val - " + rightVal + "\n");

        console.log(leftVal, rightVal)

        let resp = await this.modal.show("Vacuum Sensor Test Complete", "Test is complete. Click OK to download test report.");

        if(resp == true){
            let filename = new Date().toISOString();
            filename = filename + "-vactest.txt"
            this.download(filename, testDataBuffer);
        }

    }

    download(filename, text) {
        var element = document.createElement('a');
        element.setAttribute('href', 'data:text/plain;charset=utf-8,' + encodeURIComponent(text));
        element.setAttribute('download', filename);

        element.style.display = 'none';
        document.body.appendChild(element);

        element.click();

        document.body.removeChild(element);
    }

    async goToRelative(x, y){
        await this.send([
            "G91",  // Set relative positioning
            `G0 X${x} Y${y}`,  // Move relative to current position
            "G90"   // Set absolute positioning
          ]);
    }

    async goTo(x, y){
        await this.send([
            `G0 X${x} Y${y}`, 
          ]);
    }
  
  }