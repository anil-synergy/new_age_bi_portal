using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace PowerBIPortal.Core.Utility
{
    public class CommonUtility
    {
        public static bool CheckNullOrEmpty<T>(T value) where T : class
        {
            return value == default(T);
        }

        public static bool IsNull<T>(T value) where T : class
        {
            return value == default(T);
        }

        public static bool IsNotNull<T>(T value) where T : class
        {
            return !(value == default(T));
        }
        public static string CapitalizeLetter(string name)
        {
            char[] array = name.ToCharArray();
            // Handle the first letter in the string.  
            if (array.Length >= 1)
            {
                if (char.IsLower(array[0]))
                {
                    array[0] = char.ToUpper(array[0]);
                }
            }
            // Scan through the letters, checking for spaces.  
            // ... Uppercase the lowercase letters following spaces.  
            for (int i = 1; i < array.Length; i++)
            {
                if (array[i - 1] == ' ')
                {
                    if (char.IsLower(array[i]))
                    {
                        array[i] = char.ToUpper(array[i]);
                    }
                }
            }
            return new string(array);
        }
    }

}
