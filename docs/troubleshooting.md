# Debugging Troubleshooting Guide

🔧 **COMMON ISSUES & SOLUTIONS:**

## 1. Debug session won't start:
- Ensure proper language extension is installed
- Check that file path is correct and accessible
- Verify workspace folder is set
- Confirm the file has proper syntax and can be executed

## 2. Breakpoints not hit:
- Ensure breakpoints are on executable lines
- Check that code path is actually executed
- Verify breakpoints are enabled (not grayed out)
- Make sure the file being debugged matches the source file

## 3. Variables not showing:
- Make sure execution is paused at breakpoint
- Check that variables are in current scope
- Try different scope options (local/global/all)
- Verify variable names are correct

## 4. Step commands not working:
- Ensure debug session is active and paused
- Check that current line has executable code
- Verify debugger hasn't hit an exception

## 5. Performance Issues:
- Avoid setting too many breakpoints
- Use conditional breakpoints for frequently executed code

## 6. Configuration Problems:
- Check launch.json configuration syntax
- Verify environment variables are set correctly
- Ensure working directory is correct